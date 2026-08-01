import { randomUUID } from 'node:crypto';
import type { CombatTeamPayload } from '../../contracts/group-combat.events.js';
import type {
  CombatActionResolutionPayload,
  CombatActionResultPayload,
  CombatFinishReason,
  CombatParticipantPayload,
  CombatSnapshot,
} from '../../contracts/socket.events.js';
import type {
  CombatEffectOperation,
  SkillCatalogDefinition,
  SkillScalingStat,
  SkillTargeting,
} from '../skills/skill.types.js';
import {
  COMBAT_CONTRACT_VERSION,
  COMBAT_RULES_VERSION,
  type CombatFallbackAction,
} from './combat.contracts.js';
import {
  adjacentFormationSlots,
  COMBAT_DISCONNECT_GRACE_MS,
  COMBAT_EVENT_HISTORY_LIMIT,
  COMBAT_TEAM_LIMIT,
  controlDurationMultiplier,
  decisionPercentile,
  deterministicFormationSlots,
  formationLineForSlot,
  magicalDamageMultiplier,
  physicalDamageMultiplier,
  STANDARD_COMBAT_TIMING,
  type CombatTimingPolicy,
} from './combat.rules.js';
import type {
  CombatActionCommand,
  CombatActorInput,
  CombatLegalAction,
  CombatRuntime,
  CombatRuntimeActor,
  CombatRuntimeStatus,
  CombatTeamInput,
} from './combat.types.js';

type RandomSource = () => number;

const BASIC_ATTACK_VISUAL = {
  castEffectKey: 'basic-attack:cast',
  projectileEffectKey: 'vfx:weapon-trail',
  impactEffectKey: 'basic-attack:impact',
  accentColor: '#f5d88a',
  travelMs: 280,
};

const TACTICAL_VISUAL = {
  castEffectKey: 'tactical:cast',
  impactEffectKey: 'tactical:impact',
  accentColor: '#f5d88a',
};

const NEGATIVE_STATUSES = new Set([
  'BURN',
  'BLEED',
  'SLOWED',
  'STUNNED',
  'ROOTED',
  'EXPOSED',
  'STAGGER',
  'TAUNT',
  'DAMAGE_TAKEN_INCREASE',
]);

const HARD_CONTROL_STATUSES = new Set(['STUNNED']);

const TELEGRAPH_SKILLS = new Set([
  'mage-meteor',
  'mage-elemental-cataclysm',
  'warrior-unbreakable-assault',
]);

const MAX_PROCESSED_OPERATIONS = 256;
const TRANSFER_ENERGY_AMOUNT = 15;
const INTERRUPT_ENERGY_COST = 10;

export class CombatEngine {
  constructor(private readonly random: RandomSource = Math.random) {}

  createRequest(
    combatId: string,
    zoneType: CombatRuntime['zoneType'],
    mapId: string,
    initiators: CombatTeamInput,
    recipients: CombatTeamInput,
    now: number,
    expiresAt: number,
    timingPolicy: CombatTimingPolicy = STANDARD_COMBAT_TIMING,
  ): CombatRuntime {
    this.assertTeamInput(initiators);
    this.assertTeamInput(recipients);
    this.assertDistinctTeams(initiators, recipients);
    this.assertTimingPolicy(timingPolicy);
    const firstTeamId = `${combatId}:team-a`;
    const secondTeamId = `${combatId}:team-b`;
    const firstSlots = deterministicFormationSlots(initiators.actors.length);
    const secondSlots = deterministicFormationSlots(recipients.actors.length);
    const firstActors = initiators.actors.map((actor, index) =>
      this.toRuntimeActor(actor, firstTeamId, firstSlots[index]!),
    );
    const secondActors = recipients.actors.map((actor, index) =>
      this.toRuntimeActor(actor, secondTeamId, secondSlots[index]!),
    );
    return {
      combatId,
      status: 'REQUESTED',
      phase: 'DECISION',
      zoneType,
      mapId,
      createdAt: now,
      expiresAt,
      turnNumber: 0,
      initiatorActorId: initiators.anchorActorId,
      recipientActorId: recipients.anchorActorId,
      teams: [
        {
          teamId: firstTeamId,
          anchorActorId: initiators.anchorActorId,
          sourceGroupId: initiators.sourceGroupId,
          actorIds: firstActors.map((actor) => actor.actorId),
        },
        {
          teamId: secondTeamId,
          anchorActorId: recipients.anchorActorId,
          sourceGroupId: recipients.sourceGroupId,
          actorIds: secondActors.map((actor) => actor.actorId),
        },
      ],
      actors: [...firstActors, ...secondActors],
      turnOrder: [],
      timingPolicy: { ...timingPolicy },
      events: [],
      nextSequence: 1,
      processedOperations: new Map(),
      decisionDurationsMs: [],
    };
  }

  start(runtime: CombatRuntime, now: number): CombatSnapshot {
    if (runtime.status !== 'REQUESTED') return this.snapshot(runtime);
    runtime.status = 'ACTIVE';
    runtime.phase = 'DECISION';
    runtime.startedAt = now;
    runtime.expiresAt = undefined;
    runtime.turnNumber = 1;
    runtime.turnOrder = [...runtime.actors]
      .map((actor) => ({ actorId: actor.actorId, initiative: actor.agility + this.random() }))
      .sort(
        (left, right) =>
          right.initiative - left.initiative || left.actorId.localeCompare(right.actorId),
      )
      .map((entry) => entry.actorId);
    runtime.activeActorId = runtime.turnOrder[0];
    this.beginDecision(runtime, now, false);
    return this.snapshot(runtime);
  }

  decline(
    runtime: CombatRuntime,
    reason: Extract<CombatFinishReason, 'DECLINED' | 'REQUEST_EXPIRED' | 'CANCELLED'>,
    now: number,
  ): CombatSnapshot {
    runtime.status =
      reason === 'DECLINED'
        ? 'DECLINED'
        : reason === 'REQUEST_EXPIRED'
          ? 'EXPIRED'
          : 'CANCELLED';
    runtime.finishReason = reason;
    runtime.finishedAt = now;
    runtime.expiresAt = undefined;
    runtime.telegraph = undefined;
    return this.snapshot(runtime);
  }

  terminate(
    runtime: CombatRuntime,
    reason: Extract<CombatFinishReason, 'SERVER_SHUTDOWN' | 'CANCELLED'>,
    now: number,
  ): CombatSnapshot {
    runtime.status = reason === 'CANCELLED' ? 'CANCELLED' : 'FINISHED';
    runtime.finishReason = reason;
    runtime.finishedAt = now;
    runtime.activeActorId = undefined;
    runtime.turnStartedAt = undefined;
    runtime.turnEndsAt = undefined;
    runtime.telegraph = undefined;
    runtime.phase = 'RESOLVING';
    return this.snapshot(runtime);
  }

  act(
    runtime: CombatRuntime,
    actorId: string,
    command: CombatActionCommand,
    now: number,
  ): CombatSnapshot {
    return this.actInternal(runtime, actorId, command, now, false);
  }

  private actInternal(
    runtime: CombatRuntime,
    actorId: string,
    command: CombatActionCommand,
    now: number,
    allowDisconnected: boolean,
  ): CombatSnapshot {
    const operationFingerprint = this.operationFingerprint(actorId, command);
    if (command.operationId) {
      const processed = runtime.processedOperations.get(command.operationId);
      if (processed) {
        if (processed.fingerprint !== operationFingerprint) {
          throw new Error('COMBAT_OPERATION_CONFLICT');
        }
        return this.snapshot(runtime);
      }
    }

    if (runtime.status !== 'ACTIVE') throw new Error('COMBAT_NOT_ACTIVE');

    if (
      command.expectedTurnNumber !== undefined &&
      command.expectedTurnNumber !== runtime.turnNumber
    ) {
      throw new Error('COMBAT_STALE_TURN');
    }
    if (
      command.contractVersion !== undefined &&
      command.contractVersion !== COMBAT_CONTRACT_VERSION
    ) {
      throw new Error('COMBAT_CONTRACT_UNSUPPORTED');
    }

    const snapshot =
      runtime.phase === 'REACTION'
        ? this.resolveReaction(runtime, actorId, command, now)
        : this.resolveDecision(runtime, actorId, command, now, allowDisconnected);

    if (command.operationId) {
      runtime.processedOperations.set(command.operationId, {
        fingerprint: operationFingerprint,
        eventSequence: runtime.nextSequence - 1,
      });
      while (runtime.processedOperations.size > MAX_PROCESSED_OPERATIONS) {
        const oldest = runtime.processedOperations.keys().next().value as string | undefined;
        if (!oldest) break;
        runtime.processedOperations.delete(oldest);
      }
    }
    return snapshot;
  }

  timeout(runtime: CombatRuntime, actorId: string, now: number): CombatSnapshot {
    if (runtime.status !== 'ACTIVE') return this.snapshot(runtime);
    if (runtime.phase === 'REACTION') return this.resolveTelegraph(runtime, now);
    if (runtime.activeActorId !== actorId) throw new Error('COMBAT_NOT_YOUR_TURN');
    const actor = this.actor(runtime, actorId);
    const operationId = `timeout:${runtime.turnNumber}:${actorId}`;
    switch (actor.fallbackAction) {
      case 'BASIC_ATTACK': {
        const target = this.legalTargets(runtime, actor, 'ENEMY')[0];
        return target
          ? this.actInternal(
              runtime,
              actorId,
              {
                action: 'BASIC_ATTACK',
                targetActorId: target.actorId,
                operationId,
                expectedTurnNumber: runtime.turnNumber,
              },
              now,
              true,
            )
          : this.actInternal(
              runtime,
              actorId,
              { action: 'SKIP', operationId, expectedTurnNumber: runtime.turnNumber },
              now,
              true,
            );
      }
      case 'SKIP':
        return this.actInternal(
          runtime,
          actorId,
          { action: 'SKIP', operationId, expectedTurnNumber: runtime.turnNumber },
          now,
          true,
        );
      case 'DEFEND':
      default:
        return this.actInternal(
          runtime,
          actorId,
          { action: 'DEFEND', operationId, expectedTurnNumber: runtime.turnNumber },
          now,
          true,
        );
    }
  }

  resolveTelegraph(runtime: CombatRuntime, now: number): CombatSnapshot {
    if (runtime.status !== 'ACTIVE' || runtime.phase !== 'REACTION' || !runtime.telegraph) {
      return this.snapshot(runtime);
    }
    const telegraph = runtime.telegraph;
    const caster = this.actor(runtime, telegraph.actorId);
    runtime.phase = 'RESOLVING';
    runtime.turnEndsAt = undefined;

    if (telegraph.interruptedByActorId || !this.canFight(caster)) {
      runtime.telegraph = undefined;
      return this.advance(runtime, now);
    }

    const skill = this.requireSkill(caster, telegraph.skillKey);
    const targets = telegraph.targetActorIds
      .map((targetActorId) => runtime.actors.find((candidate) => candidate.actorId === targetActorId))
      .filter((candidate): candidate is CombatRuntimeActor => Boolean(candidate && this.canFight(candidate)));
    if (targets.length === 0) {
      runtime.telegraph = undefined;
      return this.advance(runtime, now);
    }

    const results = targets.map((target) => this.emptyResult(target.actorId));
    targets.forEach((target, index) =>
      this.resolveSkill(runtime, caster, target, skill.definition, results[index]!),
    );
    this.appendEvent(runtime, {
      actorId: caster.actorId,
      targetActorId: telegraph.targetActorId ?? targets[0]?.actorId,
      action: 'SKILL',
      skillKey: skill.definition.key,
      label: skill.definition.name,
      animationKey: skill.definition.animationKey,
      visual: skill.definition.visual,
      results,
      occurredAt: now,
    });
    runtime.telegraph = undefined;

    const defeatedTeam = this.defeatedTeam(runtime);
    if (defeatedTeam) {
      return this.finish(runtime, caster.teamId, caster.actorId, 'DEFEATED', now);
    }
    return this.advance(runtime, now);
  }

  disconnect(runtime: CombatRuntime, actorId: string, now: number): CombatSnapshot {
    if (runtime.status !== 'ACTIVE') return this.snapshot(runtime);
    const actor = this.actor(runtime, actorId);
    actor.disconnectedAt ??= now;
    if (runtime.activeActorId === actorId && runtime.phase === 'DECISION') {
      runtime.turnEndsAt = Math.min(
        runtime.turnEndsAt ?? Number.POSITIVE_INFINITY,
        now + runtime.timingPolicy.disconnectedFallbackMs,
      );
    }
    return this.snapshot(runtime);
  }

  reconnect(runtime: CombatRuntime, actorId: string, now = Date.now()): CombatSnapshot {
    const actor = this.actor(runtime, actorId);
    const wasDisconnected = actor.disconnectedAt !== undefined;
    actor.disconnectedAt = undefined;
    if (
      wasDisconnected &&
      runtime.status === 'ACTIVE' &&
      runtime.phase === 'DECISION' &&
      runtime.activeActorId === actorId
    ) {
      runtime.turnStartedAt = now;
      runtime.turnEndsAt = now + runtime.timingPolicy.decisionMs;
    }
    return this.snapshot(runtime);
  }

  isDisconnectGraceExpired(runtime: CombatRuntime, actorId: string, now: number): boolean {
    const disconnectedAt = this.actor(runtime, actorId).disconnectedAt;
    return disconnectedAt !== undefined && now - disconnectedAt >= COMBAT_DISCONNECT_GRACE_MS;
  }

  configureFallback(
    runtime: CombatRuntime,
    actorId: string,
    fallbackAction: CombatFallbackAction,
  ): CombatSnapshot {
    this.actor(runtime, actorId).fallbackAction = fallbackAction;
    return this.snapshot(runtime);
  }

  forfeit(
    runtime: CombatRuntime,
    actorId: string,
    now: number,
    reason: Extract<CombatFinishReason, 'FORFEIT' | 'DISCONNECTED'> = 'FORFEIT',
  ): CombatSnapshot {
    if (runtime.status === 'REQUESTED') return this.decline(runtime, 'CANCELLED', now);
    if (runtime.status !== 'ACTIVE') return this.snapshot(runtime);
    const actor = this.actor(runtime, actorId);
    actor.withdrawn = true;
    actor.hp = 0;
    actor.statuses = [];
    actor.disconnectedAt = undefined;
    if (runtime.telegraph?.actorId === actorId) runtime.telegraph = undefined;
    const winningTeam = this.opposingTeam(runtime, actor.teamId);
    if (this.isTeamDefeated(runtime, actor.teamId)) {
      const winner = this.firstLivingActor(runtime, winningTeam.teamId);
      return this.finish(runtime, winningTeam.teamId, winner?.actorId, reason, now);
    }
    if (runtime.activeActorId === actorId) return this.advance(runtime, now);
    return this.snapshot(runtime);
  }

  legalActions(runtime: CombatRuntime, actorId: string): CombatLegalAction[] {
    if (runtime.status !== 'ACTIVE') return [];
    const actor = this.actor(runtime, actorId);
    if (!this.canFight(actor) || actor.disconnectedAt !== undefined) return [];

    if (runtime.phase === 'REACTION') {
      const telegraph = runtime.telegraph;
      if (
        !telegraph ||
        !telegraph.reactionActorIds.includes(actorId) ||
        telegraph.reactedActorIds.includes(actorId)
      ) {
        return [];
      }
      const reactions: CombatLegalAction[] = [
        {
          action: 'DEFEND',
          targeting: 'SELF',
          targetActorIds: [actorId],
          reactionOnly: true,
        },
        {
          action: 'COUNTER',
          targeting: 'SELF',
          targetActorIds: [actorId],
          reactionOnly: true,
        },
      ];
      if (telegraph.interruptible && actor.energy >= INTERRUPT_ENERGY_COST) {
        reactions.unshift({
          action: 'INTERRUPT',
          targeting: 'ENEMY',
          targetActorIds: [telegraph.actorId],
          reactionOnly: true,
        });
      }
      return reactions;
    }

    if (runtime.activeActorId !== actorId) return [];
    const actions: CombatLegalAction[] = [];
    const basicTargets = this.legalTargets(runtime, actor, 'ENEMY');
    if (basicTargets.length > 0) {
      actions.push({
        action: 'BASIC_ATTACK',
        targeting: 'ENEMY',
        targetActorIds: basicTargets.map((target) => target.actorId),
      });
    }
    for (const [skillKey, skill] of actor.skills) {
      if (skill.cooldownTurnsRemaining > 0 || actor.energy < skill.definition.energyCost) continue;
      const targets = this.legalTargets(
        runtime,
        actor,
        skill.definition.targeting,
        skill.definition,
      );
      if (targets.length === 0) continue;
      actions.push({
        action: 'SKILL',
        skillKey,
        targeting: this.normalizeTargeting(skill.definition.targeting),
        targetActorIds: targets.map((target) => target.actorId),
      });
    }

    actions.push({ action: 'DEFEND', targeting: 'SELF', targetActorIds: [actorId] });
    actions.push({ action: 'COUNTER', targeting: 'SELF', targetActorIds: [actorId] });
    actions.push({ action: 'SKIP', targeting: 'SELF', targetActorIds: [actorId] });

    const interceptTargets = this.interceptTargets(runtime, actor);
    if (interceptTargets.length > 0) {
      actions.push({
        action: 'INTERCEPT',
        targeting: 'ALLY',
        targetActorIds: interceptTargets.map((target) => target.actorId),
      });
    }
    const enemies = this.livingEnemies(runtime, actor.teamId);
    if (enemies.length > 0) {
      actions.push({
        action: 'TAUNT',
        targeting: 'ENEMY',
        targetActorIds: enemies.map((target) => target.actorId),
      });
      actions.push({
        action: 'MARK',
        targeting: 'ENEMY',
        targetActorIds: enemies.map((target) => target.actorId),
      });
    }
    const cleanseTargets = this.livingAllies(runtime, actor.teamId).filter((target) =>
      target.statuses.some((status) => NEGATIVE_STATUSES.has(status.key)),
    );
    if (cleanseTargets.length > 0) {
      actions.push({
        action: 'CLEANSE',
        targeting: 'ALLY',
        targetActorIds: cleanseTargets.map((target) => target.actorId),
      });
    }
    const repositionTargets = this.livingAllies(runtime, actor.teamId).filter(
      (target) => target.actorId !== actor.actorId,
    );
    if (repositionTargets.length > 0) {
      actions.push({
        action: 'REPOSITION',
        targeting: 'ALLY',
        targetActorIds: repositionTargets.map((target) => target.actorId),
      });
    }
    if (actor.energy >= TRANSFER_ENERGY_AMOUNT) {
      const transferTargets = this.livingAllies(runtime, actor.teamId).filter(
        (target) => target.actorId !== actor.actorId && target.energy < target.maxEnergy,
      );
      if (transferTargets.length > 0) {
        actions.push({
          action: 'TRANSFER_ENERGY',
          targeting: 'ALLY',
          targetActorIds: transferTargets.map((target) => target.actorId),
        });
      }
    }
    return actions;
  }

  legalTargets(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    targeting: SkillTargeting,
    skill?: SkillCatalogDefinition,
  ): CombatRuntimeActor[] {
    const allies = this.livingAllies(runtime, actor.teamId);
    const enemies = this.livingEnemies(runtime, actor.teamId);
    switch (targeting) {
      case 'SELF':
        return [actor];
      case 'ALLY':
        return allies;
      case 'ALL_ALLIES':
        return allies;
      case 'ALL_ENEMIES':
      case 'AREA':
        return enemies;
      case 'FRONT_ROW': {
        const pool = this.isSupportSkill(skill) ? allies : enemies;
        return pool.filter((candidate) => candidate.formationLine === 'FRONT');
      }
      case 'BACK_ROW': {
        const pool = this.isSupportSkill(skill) ? allies : enemies;
        return pool.filter((candidate) => candidate.formationLine === 'BACK');
      }
      case 'ADJACENT': {
        const slots = new Set(adjacentFormationSlots(actor.formationSlot));
        return allies.filter((candidate) => slots.has(candidate.formationSlot));
      }
      case 'ENEMY':
      default:
        return this.reachableEnemies(runtime, actor, enemies, skill);
    }
  }

  snapshot(runtime: CombatRuntime): CombatSnapshot {
    const activeActor = runtime.activeActorId
      ? runtime.actors.find((actor) => actor.actorId === runtime.activeActorId)
      : undefined;
    const nextActor = activeActor ? this.peekNextLivingActor(runtime, activeActor.actorId) : undefined;
    const legalActionsByActorId: Record<string, CombatLegalAction[]> = {};
    if (runtime.status === 'ACTIVE') {
      if (runtime.phase === 'REACTION' && runtime.telegraph) {
        for (const actorId of runtime.telegraph.reactionActorIds) {
          const legal = this.legalActions(runtime, actorId);
          if (legal.length > 0) legalActionsByActorId[actorId] = legal;
        }
      } else if (runtime.activeActorId) {
        const legal = this.legalActions(runtime, runtime.activeActorId);
        if (legal.length > 0) legalActionsByActorId[runtime.activeActorId] = legal;
      }
    }
    const samples = runtime.decisionDurationsMs.length;
    return {
      combatId: runtime.combatId,
      status: runtime.status,
      zoneType: runtime.zoneType,
      mapId: runtime.mapId,
      createdAt: runtime.createdAt,
      expiresAt: runtime.expiresAt,
      startedAt: runtime.startedAt,
      finishedAt: runtime.finishedAt,
      turnNumber: runtime.turnNumber,
      activeActorId: runtime.activeActorId,
      turnStartedAt: runtime.turnStartedAt,
      turnEndsAt: runtime.turnEndsAt,
      winnerActorId: runtime.winnerActorId,
      winnerTeamId: runtime.winnerTeamId,
      finishReason: runtime.finishReason,
      initiatorActorId: runtime.initiatorActorId,
      recipientActorId: runtime.recipientActorId,
      teams: runtime.teams.map((team) => ({ ...team, actorIds: [...team.actorIds] })) as [
        CombatTeamPayload,
        CombatTeamPayload,
      ],
      participants: runtime.actors.map((actor) => this.participant(actor)) as unknown as [
        CombatParticipantPayload,
        CombatParticipantPayload,
      ],
      recentActions: [...runtime.events],
      contractVersion: COMBAT_CONTRACT_VERSION,
      rulesVersion: COMBAT_RULES_VERSION,
      phase: runtime.phase,
      eventSequence: runtime.nextSequence - 1,
      turnQueue: [...runtime.turnOrder],
      nextActorId: nextActor?.actorId,
      timing: {
        policyKey: runtime.timingPolicy.key,
        decisionMs: runtime.timingPolicy.decisionMs,
        reactionMs: runtime.timingPolicy.reactionMs,
        disconnectedFallbackMs: runtime.timingPolicy.disconnectedFallbackMs,
        presentationGraceMs: runtime.timingPolicy.presentationGraceMs,
      },
      telegraph: runtime.telegraph
        ? {
            ...runtime.telegraph,
            targetActorIds: [...runtime.telegraph.targetActorIds],
            reactionActorIds: [...runtime.telegraph.reactionActorIds],
            reactedActorIds: [...runtime.telegraph.reactedActorIds],
          }
        : undefined,
      legalActionsByActorId,
      decisionMetrics: {
        samples,
        medianMs: decisionPercentile(runtime.decisionDurationsMs, 0.5),
        p95Ms: decisionPercentile(runtime.decisionDurationsMs, 0.95),
      },
    };
  }

  private resolveDecision(
    runtime: CombatRuntime,
    actorId: string,
    command: CombatActionCommand,
    now: number,
    allowDisconnected: boolean,
  ): CombatSnapshot {
    if (runtime.phase !== 'DECISION') throw new Error('COMBAT_ACTION_INVALID');
    if (runtime.activeActorId !== actorId) throw new Error('COMBAT_NOT_YOUR_TURN');
    const actor = this.actor(runtime, actorId);
    if (!this.canFight(actor)) throw new Error('COMBAT_FORBIDDEN');
    if (actor.disconnectedAt !== undefined && !allowDisconnected) {
      throw new Error('COMBAT_FORBIDDEN');
    }

    if (command.action === 'SKILL') {
      const usedSkill = this.requireSkill(actor, command.skillKey);
      if (usedSkill.cooldownTurnsRemaining) throw new Error('COMBAT_SKILL_COOLDOWN');
      if (actor.energy < usedSkill.definition.energyCost) {
        throw new Error('COMBAT_INSUFFICIENT_ENERGY');
      }
      const targets = this.selectActionTargets(
        runtime,
        actor,
        usedSkill.definition.targeting,
        command.targetActorId,
        usedSkill.definition,
      );
      this.recordDecisionDuration(runtime, now);
      actor.energy -= usedSkill.definition.energyCost;
      this.decrementCooldowns(actor);
      usedSkill.cooldownTurnsRemaining = usedSkill.definition.cooldownTurns;
      this.decrementStatuses(actor, runtime.turnNumber);

      if (TELEGRAPH_SKILLS.has(usedSkill.definition.key)) {
        return this.startTelegraph(runtime, actor, usedSkill.definition, targets, now);
      }

      const results = targets.map((target) => this.emptyResult(target.actorId));
      targets.forEach((target, index) =>
        this.resolveSkill(runtime, actor, target, usedSkill.definition, results[index]!),
      );
      this.appendEvent(runtime, {
        actorId,
        targetActorId:
          usedSkill.definition.targeting === 'SELF' ? actor.actorId : targets[0]?.actorId,
        action: 'SKILL',
        skillKey: usedSkill.definition.key,
        label: usedSkill.definition.name,
        animationKey: usedSkill.definition.animationKey,
        visual: usedSkill.definition.visual,
        results,
        occurredAt: now,
      });
      return this.afterAction(runtime, actor, now);
    }

    if (command.action === 'BASIC_ATTACK') {
      const targets = this.selectActionTargets(
        runtime,
        actor,
        'ENEMY',
        command.targetActorId,
      );
      this.recordDecisionDuration(runtime, now);
      const result = this.emptyResult(targets[0]!.actorId);
      this.resolveBasicAttack(runtime, actor, targets[0]!, result);
      this.decrementCooldowns(actor);
      this.decrementStatuses(actor, runtime.turnNumber);
      this.appendEvent(runtime, {
        actorId,
        targetActorId: result.targetActorId,
        action: 'BASIC_ATTACK',
        label: 'Basic attack',
        animationKey: 'basic-attack',
        visual: BASIC_ATTACK_VISUAL,
        results: [result],
        occurredAt: now,
      });
      return this.afterAction(runtime, actor, now);
    }

    const snapshot = this.resolveTacticalAction(runtime, actor, command, now, false);
    this.recordDecisionDuration(runtime, now);
    this.decrementCooldowns(actor);
    this.decrementStatuses(actor, runtime.turnNumber);
    if (snapshot) return snapshot;
    return this.afterAction(runtime, actor, now);
  }

  private resolveReaction(
    runtime: CombatRuntime,
    actorId: string,
    command: CombatActionCommand,
    now: number,
  ): CombatSnapshot {
    const telegraph = runtime.telegraph;
    if (!telegraph || runtime.phase !== 'REACTION') throw new Error('COMBAT_ACTION_INVALID');
    if (
      !telegraph.reactionActorIds.includes(actorId) ||
      telegraph.reactedActorIds.includes(actorId)
    ) {
      throw new Error('COMBAT_FORBIDDEN');
    }
    const actor = this.actor(runtime, actorId);
    if (!this.canFight(actor) || actor.disconnectedAt !== undefined) {
      throw new Error('COMBAT_FORBIDDEN');
    }
    if (!['INTERRUPT', 'COUNTER', 'DEFEND'].includes(command.action)) {
      throw new Error('COMBAT_ACTION_INVALID');
    }
    const immediate = this.resolveTacticalAction(runtime, actor, command, now, true);
    if (!immediate) telegraph.reactedActorIds.push(actorId);
    return immediate ?? this.snapshot(runtime);
  }

  private resolveTacticalAction(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    command: CombatActionCommand,
    now: number,
    reaction: boolean,
  ): CombatSnapshot | undefined {
    const target = command.targetActorId
      ? runtime.actors.find((candidate) => candidate.actorId === command.targetActorId)
      : undefined;
    switch (command.action) {
      case 'DEFEND': {
        const status = this.addTypedStatus(runtime, actor, actor, 'GUARD', 1, 0.45);
        const result = this.emptyResult(actor.actorId);
        result.statusesApplied.push(this.statusPayload(status));
        this.appendTacticalEvent(runtime, actor, 'DEFEND', 'Defensive stance', [result], now);
        return undefined;
      }
      case 'INTERCEPT': {
        if (reaction || !target || !this.interceptTargets(runtime, actor).includes(target)) {
          throw new Error('COMBAT_ACTION_INVALID');
        }
        const status = this.addTypedStatus(runtime, actor, target, 'PROTECTED', 2);
        const result = this.emptyResult(target.actorId);
        result.statusesApplied.push(this.statusPayload(status));
        this.appendTacticalEvent(runtime, actor, 'INTERCEPT', 'Protect ally', [result], now, target.actorId);
        return undefined;
      }
      case 'TAUNT': {
        if (reaction || !target || target.teamId === actor.teamId || !this.canFight(target)) {
          throw new Error('COMBAT_ACTION_INVALID');
        }
        const status = this.addTypedStatus(runtime, actor, target, 'TAUNT', 2);
        const result = this.emptyResult(target.actorId);
        result.statusesApplied.push(this.statusPayload(status));
        this.appendTacticalEvent(runtime, actor, 'TAUNT', 'Taunt', [result], now, target.actorId);
        return undefined;
      }
      case 'INTERRUPT': {
        const telegraph = runtime.telegraph;
        if (
          !reaction ||
          !telegraph ||
          !telegraph.interruptible ||
          telegraph.actorId === actor.actorId ||
          (command.targetActorId !== undefined && command.targetActorId !== telegraph.actorId) ||
          actor.energy < INTERRUPT_ENERGY_COST
        ) {
          throw new Error('COMBAT_ACTION_INVALID');
        }
        actor.energy -= INTERRUPT_ENERGY_COST;
        telegraph.interruptedByActorId = actor.actorId;
        const caster = this.actor(runtime, telegraph.actorId);
        const stagger = this.addTypedStatus(runtime, actor, caster, 'STAGGER', 1, 0.25);
        const result = this.emptyResult(caster.actorId);
        result.statusesApplied.push(this.statusPayload(stagger));
        this.appendTacticalEvent(
          runtime,
          actor,
          'INTERRUPT',
          'Interrupt',
          [result],
          now,
          caster.actorId,
        );
        runtime.telegraph = undefined;
        runtime.phase = 'RESOLVING';
        return this.advance(runtime, now);
      }
      case 'CLEANSE': {
        if (reaction || !target || target.teamId !== actor.teamId || !this.canFight(target)) {
          throw new Error('COMBAT_ACTION_INVALID');
        }
        const removed = this.cleanse(target, 2);
        if (removed.length === 0) throw new Error('COMBAT_ACTION_INVALID');
        const result = this.emptyResult(target.actorId);
        result.statusesRemoved = removed;
        result.cleansedStatuses = removed;
        this.appendTacticalEvent(runtime, actor, 'CLEANSE', 'Cleanse', [result], now, target.actorId);
        return undefined;
      }
      case 'MARK': {
        if (reaction || !target || target.teamId === actor.teamId || !this.canFight(target)) {
          throw new Error('COMBAT_ACTION_INVALID');
        }
        const exposed = this.addTypedStatus(runtime, actor, target, 'EXPOSED', 2, 0.35);
        const result = this.emptyResult(target.actorId);
        result.statusesApplied.push(this.statusPayload(exposed));
        this.appendTacticalEvent(runtime, actor, 'MARK', 'Expose target', [result], now, target.actorId);
        return undefined;
      }
      case 'COUNTER': {
        const counter = this.addTypedStatus(runtime, actor, actor, 'COUNTER_READY', 1, 0.3);
        const result = this.emptyResult(actor.actorId);
        result.statusesApplied.push(this.statusPayload(counter));
        this.appendTacticalEvent(runtime, actor, 'COUNTER', 'Prepare counter', [result], now);
        return undefined;
      }
      case 'REPOSITION': {
        if (
          reaction ||
          !target ||
          target.teamId !== actor.teamId ||
          target.actorId === actor.actorId ||
          !this.canFight(target)
        ) {
          throw new Error('COMBAT_ACTION_INVALID');
        }
        const actorSlot = actor.formationSlot;
        actor.formationSlot = target.formationSlot;
        target.formationSlot = actorSlot;
        actor.formationLine = formationLineForSlot(actor.formationSlot);
        target.formationLine = formationLineForSlot(target.formationSlot);
        this.appendTacticalEvent(
          runtime,
          actor,
          'REPOSITION',
          'Swap formation slots',
          [this.emptyResult(actor.actorId), this.emptyResult(target.actorId)],
          now,
          target.actorId,
        );
        return undefined;
      }
      case 'TRANSFER_ENERGY': {
        if (
          reaction ||
          !target ||
          target.teamId !== actor.teamId ||
          target.actorId === actor.actorId ||
          !this.canFight(target) ||
          actor.energy < TRANSFER_ENERGY_AMOUNT ||
          target.energy >= target.maxEnergy
        ) {
          throw new Error('COMBAT_ACTION_INVALID');
        }
        const transferred = Math.min(TRANSFER_ENERGY_AMOUNT, target.maxEnergy - target.energy);
        actor.energy -= transferred;
        target.energy += transferred;
        const sourceResult = this.emptyResult(actor.actorId);
        sourceResult.energyDelta = -transferred;
        const targetResult = this.emptyResult(target.actorId);
        targetResult.energyDelta = transferred;
        this.appendTacticalEvent(
          runtime,
          actor,
          'TRANSFER_ENERGY',
          'Transfer energy',
          [sourceResult, targetResult],
          now,
          target.actorId,
        );
        return undefined;
      }
      case 'SKIP': {
        if (reaction) throw new Error('COMBAT_ACTION_INVALID');
        this.appendTacticalEvent(
          runtime,
          actor,
          'SKIP',
          'Hold position',
          [this.emptyResult(actor.actorId)],
          now,
        );
        return undefined;
      }
      default:
        throw new Error('COMBAT_ACTION_INVALID');
    }
  }

  private startTelegraph(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    skill: SkillCatalogDefinition,
    targets: CombatRuntimeActor[],
    now: number,
  ): CombatSnapshot {
    runtime.phase = 'REACTION';
    const reactionStartsAt = now + runtime.timingPolicy.presentationGraceMs;
    runtime.telegraph = {
      actorId: actor.actorId,
      skillKey: skill.key,
      label: skill.name,
      targetActorId: targets[0]?.actorId,
      targetActorIds: targets.map((target) => target.actorId),
      startedAt: reactionStartsAt,
      resolvesAt: reactionStartsAt + runtime.timingPolicy.reactionMs,
      reactionActorIds: this.livingEnemies(runtime, actor.teamId).map((target) => target.actorId),
      reactedActorIds: [],
      interruptible: true,
    };
    runtime.turnEndsAt = runtime.telegraph.resolvesAt;
    this.appendEvent(runtime, {
      actorId: actor.actorId,
      targetActorId: targets[0]?.actorId,
      action: 'SKILL',
      skillKey: `telegraph:${skill.key}`,
      label: `Preparing ${skill.name}`,
      animationKey: 'combat-telegraph',
      visual: {
        castEffectKey: 'combat-telegraph:cast',
        impactEffectKey: 'combat-telegraph:impact',
        accentColor: skill.visual.accentColor,
      },
      results: targets.map((target) => this.emptyResult(target.actorId)),
      occurredAt: now,
    });
    return this.snapshot(runtime);
  }

  private afterAction(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    now: number,
  ): CombatSnapshot {
    const defeatedTeam = this.defeatedTeam(runtime);
    if (defeatedTeam) return this.finish(runtime, actor.teamId, actor.actorId, 'DEFEATED', now);
    return this.advance(runtime, now);
  }

  private advance(runtime: CombatRuntime, now: number): CombatSnapshot {
    runtime.telegraph = undefined;
    runtime.phase = 'RESOLVING';
    const guardLimit = Math.max(4, runtime.actors.length * 3);
    for (let guard = 0; guard < guardLimit; guard += 1) {
      const next = this.nextLivingActor(runtime, runtime.activeActorId);
      if (!next) return this.terminate(runtime, 'CANCELLED', now);
      runtime.turnNumber += 1;
      runtime.activeActorId = next.actorId;
      const turnResults = this.beginTurn(next, runtime.turnNumber);
      if (turnResults) {
        this.appendEvent(runtime, {
          actorId: next.actorId,
          targetActorId: next.actorId,
          action: 'STATUS_TICK',
          label: 'Ongoing effects',
          animationKey: 'status-tick',
          visual: {
            castEffectKey: 'status-tick:cast',
            impactEffectKey: 'status-tick:impact',
            accentColor: '#ef8354',
          },
          results: [turnResults],
          occurredAt: now,
        });
      }

      if (!this.canFight(next)) {
        const winningTeam = this.opposingTeam(runtime, next.teamId);
        if (this.isTeamDefeated(runtime, next.teamId)) {
          const winner = this.firstLivingActor(runtime, winningTeam.teamId);
          return this.finish(runtime, winningTeam.teamId, winner?.actorId, 'DEFEATED', now);
        }
        continue;
      }

      if (!this.hasStatus(next, 'STUNNED')) {
        this.beginDecision(runtime, now, true);
        return this.snapshot(runtime);
      }
      const skipped = this.emptyResult(next.actorId);
      skipped.statusesRemoved = this.decrementStatuses(next, runtime.turnNumber);
      this.decrementCooldowns(next);
      this.appendEvent(runtime, {
        actorId: next.actorId,
        targetActorId: next.actorId,
        action: 'TURN_SKIPPED',
        label: 'Turn skipped',
        animationKey: 'status-stunned',
        visual: {
          castEffectKey: 'status-stunned:cast',
          impactEffectKey: 'status-stunned:impact',
          accentColor: '#a5b4fc',
        },
        results: [skipped],
        occurredAt: now,
      });
    }
    throw new Error('COMBAT_ACTION_INVALID');
  }

  private beginDecision(
    runtime: CombatRuntime,
    now: number,
    includePresentationGrace: boolean,
  ): void {
    runtime.phase = 'DECISION';
    const graceMs = includePresentationGrace
      ? runtime.timingPolicy.presentationGraceMs
      : 0;
    runtime.turnStartedAt = now + graceMs;
    const active = runtime.activeActorId
      ? this.actor(runtime, runtime.activeActorId)
      : undefined;
    runtime.turnEndsAt =
      runtime.turnStartedAt +
      (active?.disconnectedAt !== undefined
        ? runtime.timingPolicy.disconnectedFallbackMs
        : runtime.timingPolicy.decisionMs);
  }

  private beginTurn(
    actor: CombatRuntimeActor,
    currentTurn: number,
  ): CombatActionResultPayload | undefined {
    if (actor.controlDrExpiresTurn <= currentTurn) {
      actor.controlDrStacks = 0;
      actor.controlDrExpiresTurn = 0;
    }
    const result = this.emptyResult(actor.actorId);
    const previousEnergy = actor.energy;
    const haste = this.statusMagnitude(actor, 'HASTE');
    const slowed = this.statusMagnitude(actor, 'SLOWED');
    const regenMultiplier = Math.max(0.25, 1 + haste - slowed);
    const regenerated = Math.max(1, Math.round(actor.maxEnergy * 0.06 * regenMultiplier));
    actor.energy = Math.min(actor.maxEnergy, actor.energy + regenerated);
    result.energyDelta = actor.energy - previousEnergy;
    for (const status of actor.statuses) {
      if (status.key !== 'BURN' && status.key !== 'BLEED') continue;
      const damage = Math.max(1, Math.round(status.sourcePower * (status.magnitude ?? 0.2)));
      const before = actor.hp;
      actor.hp = Math.max(0, actor.hp - damage);
      result.hpDelta += actor.hp - before;
    }
    return result.hpDelta || result.energyDelta ? result : undefined;
  }

  private selectActionTargets(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    targeting: SkillTargeting,
    targetActorId: string | undefined,
    skill?: SkillCatalogDefinition,
  ): CombatRuntimeActor[] {
    const legal = this.legalTargets(runtime, actor, targeting, skill);
    if (legal.length === 0) throw new Error('COMBAT_ACTION_INVALID');
    if (['ALL_ALLIES', 'ALL_ENEMIES', 'AREA', 'FRONT_ROW', 'BACK_ROW'].includes(targeting)) {
      return legal;
    }
    if (targeting === 'SELF') return [actor];
    if (!targetActorId) return [legal[0]!];
    const selected = legal.find((candidate) => candidate.actorId === targetActorId);
    if (!selected) throw new Error('COMBAT_ACTION_INVALID');
    return [selected];
  }

  private reachableEnemies(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    enemies: CombatRuntimeActor[],
    skill?: SkillCatalogDefinition,
  ): CombatRuntimeActor[] {
    const taunt = actor.statuses.find(
      (status) => status.key === 'TAUNT' && status.turnsRemaining > 0,
    );
    if (taunt) {
      const forced = enemies.find((candidate) => candidate.actorId === taunt.sourceActorId);
      if (forced) return [forced];
    }
    if (this.canReachBack(actor, skill)) return enemies;
    const livingFront = enemies.filter((candidate) => candidate.formationLine === 'FRONT');
    return livingFront.length > 0 ? livingFront : enemies;
  }

  private canReachBack(actor: CombatRuntimeActor, skill?: SkillCatalogDefinition): boolean {
    if (actor.characterClass === 'MAGE' || actor.characterClass === 'ARCHER') return true;
    if (!skill) return false;
    return (
      skill.targeting === 'ALL_ENEMIES' ||
      skill.targeting === 'AREA' ||
      skill.targeting === 'BACK_ROW' ||
      Boolean(skill.visual.projectileEffectKey)
    );
  }

  private interceptTargets(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
  ): CombatRuntimeActor[] {
    if (actor.formationLine !== 'FRONT') return [];
    return this.livingAllies(runtime, actor.teamId).filter(
      (candidate) => candidate.actorId !== actor.actorId && candidate.formationLine === 'BACK',
    );
  }

  private resolveBasicAttack(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    result: CombatActionResultPayload,
  ): void {
    const primary = this.primaryPower(actor);
    const raw = 5 + actor.level * 1.5 + primary * 1.15;
    this.applyDamage(runtime, actor, target, raw, 'PHYSICAL', 0, result, false);
  }

  private resolveSkill(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    skill: SkillCatalogDefinition,
    result: CombatActionResultPayload,
  ): void {
    for (const effect of skill.effects) this.applyEffect(runtime, actor, target, effect, result);
  }

  private applyEffect(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    effect: CombatEffectOperation,
    result: CombatActionResultPayload,
  ): void {
    switch (effect.type) {
      case 'DAMAGE': {
        const scaling = this.scalingValue(actor, effect.scaling);
        const thresholdBonus =
          effect.targetHpBelow !== undefined &&
          target.hp / Math.max(1, target.maxHp) < effect.targetHpBelow
            ? (effect.bonusCoefficient ?? 0)
            : 0;
        const raw = 5 + actor.level * 1.25 + scaling * (effect.coefficient + thresholdBonus);
        this.applyDamage(
          runtime,
          actor,
          target,
          raw,
          effect.damageType,
          effect.armorPenetration ?? 0,
          result,
          effect.coefficient >= 1.3,
          effect.consumesStatus,
        );
        break;
      }
      case 'HEAL': {
        const scaling = this.scalingValue(actor, effect.scaling);
        const before = target.hp;
        target.hp = Math.min(
          target.maxHp,
          target.hp + Math.max(1, Math.round(scaling * effect.coefficient)),
        );
        result.hpDelta += target.hp - before;
        break;
      }
      case 'SHIELD': {
        const scaling = this.scalingValue(actor, effect.scaling);
        const amount = Math.max(1, Math.round(scaling * effect.coefficient));
        const status = this.addTypedStatus(
          runtime,
          actor,
          target,
          'SHIELD',
          effect.durationTurns,
          amount,
        );
        result.shieldDelta += amount;
        result.statusesApplied.push(this.statusPayload(status));
        break;
      }
      case 'APPLY_STATUS': {
        if (effect.chance !== undefined && this.random() > effect.chance) break;
        const status = this.addStatus(runtime, actor, target, effect, result);
        if (status) result.statusesApplied.push(this.statusPayload(status));
        break;
      }
      case 'CLEANSE': {
        const removed = this.cleanse(target, effect.maximumStatuses ?? 2);
        result.statusesRemoved.push(...removed);
        result.cleansedStatuses = removed;
        break;
      }
      case 'TRANSFER_ENERGY': {
        const amount = Math.max(0, Math.min(effect.amount, actor.energy, target.maxEnergy - target.energy));
        actor.energy -= amount;
        target.energy += amount;
        result.energyDelta += amount;
        break;
      }
    }
  }

  private applyDamage(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    originalTarget: CombatRuntimeActor,
    rawDamage: number,
    damageType: 'PHYSICAL' | 'ARCANE' | 'FIRE' | 'FROST',
    armorPenetration: number,
    result: CombatActionResultPayload,
    comboEligible: boolean,
    consumesStatus?: 'EXPOSED' | 'STAGGER' | 'BLEED',
  ): void {
    let target = originalTarget;
    const protection = originalTarget.statuses.find(
      (status) => status.key === 'PROTECTED' && status.turnsRemaining > 0,
    );
    if (protection) {
      const protector = runtime.actors.find((candidate) => candidate.actorId === protection.sourceActorId);
      if (protector && this.canFight(protector) && protector.formationLine === 'FRONT') {
        result.redirectedFromActorId = originalTarget.actorId;
        result.interceptedByActorId = protector.actorId;
        result.targetActorId = protector.actorId;
        target = protector;
      }
    }

    const rooted = this.hasStatus(target, 'ROOTED');
    const dodgeChance = rooted ? 0 : this.statusMagnitude(target, 'DODGE');
    if (dodgeChance > 0 && this.random() < dodgeChance) {
      result.dodged = true;
      return;
    }
    let outgoing =
      1 +
      this.statusMagnitude(actor, 'DAMAGE_INCREASE') +
      this.statusMagnitude(actor, 'HASTE') * 0.1 -
      this.statusMagnitude(actor, 'SLOWED') * 0.1;
    let incoming =
      1 -
      this.statusMagnitude(target, 'DAMAGE_REDUCTION') -
      this.statusMagnitude(target, 'GUARD') +
      this.statusMagnitude(target, 'DAMAGE_TAKEN_INCREASE') +
      (rooted ? 0.1 : 0);

    const exposed = this.status(target, 'EXPOSED');
    if (comboEligible && exposed) {
      outgoing += exposed.magnitude ?? 0.35;
      this.removeStatus(target, exposed.id);
      result.exposedConsumed = true;
      result.statusesRemoved.push('EXPOSED');
    }
    const stagger = this.status(target, 'STAGGER');
    if (comboEligible && stagger) {
      incoming += stagger.magnitude ?? 0.25;
      this.removeStatus(target, stagger.id);
      result.staggerConsumed = true;
      result.statusesRemoved.push('STAGGER');
    }
    if (consumesStatus) {
      const consumed = this.status(target, consumesStatus);
      if (consumed) {
        outgoing += 0.25;
        this.removeStatus(target, consumed.id);
        result.statusesRemoved.push(consumesStatus);
      }
    }

    const mitigation =
      damageType === 'PHYSICAL'
        ? physicalDamageMultiplier(target.armor, armorPenetration)
        : magicalDamageMultiplier(target.magicResistance);
    let damage = Math.max(
      1,
      Math.round(
        rawDamage *
          Math.max(0.1, outgoing) *
          Math.max(0.1, incoming) *
          mitigation *
          this.variance(),
      ),
    );
    const shields = target.statuses.filter((status) => status.key === 'SHIELD');
    for (const shield of shields) {
      if (damage <= 0) break;
      const available = Math.max(0, Math.round(shield.magnitude ?? 0));
      const absorbed = Math.min(available, damage);
      shield.magnitude = available - absorbed;
      damage -= absorbed;
      result.shieldAbsorbed += absorbed;
      result.shieldDelta -= absorbed;
    }
    target.statuses = target.statuses.filter(
      (status) => status.key !== 'SHIELD' || (status.magnitude ?? 0) > 0,
    );
    const before = target.hp;
    target.hp = Math.max(0, target.hp - damage);
    result.hpDelta += target.hp - before;

    const counter = this.status(target, 'COUNTER_READY');
    if (counter && damage > 0 && this.canFight(actor)) {
      const counterDamage = Math.max(1, Math.round(damage * (counter.magnitude ?? 0.3)));
      actor.hp = Math.max(0, actor.hp - counterDamage);
      result.counterDamage = counterDamage;
      this.removeStatus(target, counter.id);
      result.statusesRemoved.push('COUNTER_READY');
    }
  }

  private addStatus(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    effect: Extract<CombatEffectOperation, { type: 'APPLY_STATUS' }>,
    result: CombatActionResultPayload,
  ): CombatRuntimeStatus | undefined {
    const hardControl = effect.hardControl ?? HARD_CONTROL_STATUSES.has(effect.statusKey);
    let durationTurns = effect.durationTurns;
    if (hardControl && this.isPvpCombat(runtime)) {
      const multiplier = controlDurationMultiplier(target.controlDrStacks);
      if (multiplier <= 0) {
        result.rejectedStatusReason = 'DIMINISHING_RETURNS';
        return undefined;
      }
      durationTurns = Math.max(1, Math.ceil(durationTurns * multiplier));
      target.controlDrStacks = Math.min(3, target.controlDrStacks + 1);
      target.controlDrExpiresTurn = runtime.turnNumber + 6;
    }
    return this.addTypedStatus(
      runtime,
      actor,
      target,
      effect.statusKey,
      durationTurns,
      effect.magnitude,
    );
  }

  private addTypedStatus(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    key: string,
    durationTurns: number,
    magnitude?: number,
  ): CombatRuntimeStatus {
    const existing = target.statuses.find(
      (status) => status.key === key && status.sourceActorId === actor.actorId,
    );
    if (existing) {
      existing.turnsRemaining = Math.max(existing.turnsRemaining, durationTurns);
      existing.magnitude = Math.max(existing.magnitude ?? 0, magnitude ?? 0);
      existing.sourcePower = this.primaryPower(actor);
      existing.appliedTurn = runtime.turnNumber;
      return existing;
    }
    const status: CombatRuntimeStatus = {
      id: randomUUID(),
      key,
      turnsRemaining: durationTurns,
      magnitude,
      sourceActorId: actor.actorId,
      sourcePower: this.primaryPower(actor),
      appliedTurn: runtime.turnNumber,
    };
    target.statuses.push(status);
    return status;
  }

  private finish(
    runtime: CombatRuntime,
    winnerTeamId: string,
    winnerActorId: string | undefined,
    reason: CombatFinishReason,
    now: number,
  ): CombatSnapshot {
    runtime.status = 'FINISHED';
    runtime.phase = 'RESOLVING';
    runtime.winnerTeamId = winnerTeamId;
    runtime.winnerActorId = winnerActorId;
    runtime.finishReason = reason;
    runtime.finishedAt = now;
    runtime.activeActorId = undefined;
    runtime.turnStartedAt = undefined;
    runtime.turnEndsAt = undefined;
    runtime.telegraph = undefined;
    return this.snapshot(runtime);
  }

  private decrementCooldowns(actor: CombatRuntimeActor): void {
    for (const skill of actor.skills.values()) {
      skill.cooldownTurnsRemaining = Math.max(0, skill.cooldownTurnsRemaining - 1);
    }
  }

  private decrementStatuses(actor: CombatRuntimeActor, currentTurn: number): string[] {
    const removed: string[] = [];
    for (const status of actor.statuses) {
      if (status.appliedTurn >= currentTurn) continue;
      status.turnsRemaining -= 1;
      if (status.turnsRemaining <= 0) removed.push(status.key);
    }
    actor.statuses = actor.statuses.filter((status) => status.turnsRemaining > 0);
    return removed;
  }

  private cleanse(actor: CombatRuntimeActor, maximum: number): string[] {
    const removable = actor.statuses.filter((status) => NEGATIVE_STATUSES.has(status.key));
    const removed = removable.slice(0, Math.max(0, maximum));
    const removedIds = new Set(removed.map((status) => status.id));
    actor.statuses = actor.statuses.filter((status) => !removedIds.has(status.id));
    return removed.map((status) => status.key);
  }

  private appendEvent(
    runtime: CombatRuntime,
    event: Omit<CombatActionResolutionPayload, 'sequence'>,
  ): void {
    runtime.events.push({ ...event, sequence: runtime.nextSequence++ });
    if (runtime.events.length > COMBAT_EVENT_HISTORY_LIMIT) {
      runtime.events.splice(0, runtime.events.length - COMBAT_EVENT_HISTORY_LIMIT);
    }
  }

  private appendTacticalEvent(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    action: Exclude<CombatActionCommand['action'], 'BASIC_ATTACK' | 'SKILL'>,
    label: string,
    results: CombatActionResultPayload[],
    now: number,
    targetActorId?: string,
  ): void {
    this.appendEvent(runtime, {
      actorId: actor.actorId,
      targetActorId: targetActorId ?? actor.actorId,
      action: 'SKILL',
      skillKey: `tactical:${action.toLowerCase()}`,
      label,
      animationKey: `tactical-${action.toLowerCase()}`,
      visual: TACTICAL_VISUAL,
      results,
      occurredAt: now,
    });
  }

  private emptyResult(targetActorId: string): CombatActionResultPayload {
    return {
      targetActorId,
      hpDelta: 0,
      energyDelta: 0,
      shieldDelta: 0,
      shieldAbsorbed: 0,
      dodged: false,
      statusesApplied: [],
      statusesRemoved: [],
    };
  }

  private participant(actor: CombatRuntimeActor): CombatParticipantPayload {
    return {
      actorId: actor.actorId,
      teamId: actor.teamId,
      withdrawn: actor.withdrawn,
      kind: actor.kind,
      characterId: actor.characterId,
      name: actor.name,
      characterClass: actor.characterClass,
      level: actor.level,
      outfitKey: actor.outfitKey,
      renderScale: actor.renderScale,
      hp: actor.hp,
      maxHp: actor.maxHp,
      energy: actor.energy,
      maxEnergy: actor.maxEnergy,
      shield: actor.statuses
        .filter((status) => status.key === 'SHIELD')
        .reduce((sum, status) => sum + Math.max(0, Math.round(status.magnitude ?? 0)), 0),
      statuses: actor.statuses.map((status) => this.statusPayload(status)),
      skills: [...actor.skills].map(([key, skill]) => ({
        key,
        cooldownTurnsRemaining: skill.cooldownTurnsRemaining,
      })),
      formationSlot: actor.formationSlot,
      formationLine: actor.formationLine,
      guarding: this.hasStatus(actor, 'GUARD'),
      protectedByActorId: this.status(actor, 'PROTECTED')?.sourceActorId,
      disconnected: actor.disconnectedAt !== undefined,
      physicalDamageReduction: 1 - physicalDamageMultiplier(actor.armor),
      magicalDamageReduction: 1 - magicalDamageMultiplier(actor.magicResistance),
      controlDrStacks: actor.controlDrStacks,
    };
  }

  private statusPayload(status: CombatRuntimeStatus) {
    return {
      key: status.key,
      turnsRemaining: status.turnsRemaining,
      magnitude: status.magnitude,
    };
  }

  private requireSkill(actor: CombatRuntimeActor, skillKey?: string) {
    if (!skillKey) throw new Error('COMBAT_ACTION_INVALID');
    const skill = actor.skills.get(skillKey);
    if (!skill) throw new Error('COMBAT_SKILL_NOT_LEARNED');
    return skill;
  }

  private actor(runtime: CombatRuntime, actorId: string): CombatRuntimeActor {
    const actor = runtime.actors.find((candidate) => candidate.actorId === actorId);
    if (!actor) throw new Error('COMBAT_FORBIDDEN');
    return actor;
  }

  private nextLivingActor(
    runtime: CombatRuntime,
    currentActorId?: string,
  ): CombatRuntimeActor | undefined {
    if (runtime.turnOrder.length === 0) return undefined;
    const currentIndex = currentActorId ? runtime.turnOrder.indexOf(currentActorId) : -1;
    for (let offset = 1; offset <= runtime.turnOrder.length; offset += 1) {
      const actorId = runtime.turnOrder[(currentIndex + offset) % runtime.turnOrder.length]!;
      const actor = runtime.actors.find((candidate) => candidate.actorId === actorId);
      if (actor && this.canFight(actor)) return actor;
    }
    return undefined;
  }

  private peekNextLivingActor(
    runtime: CombatRuntime,
    currentActorId?: string,
  ): CombatRuntimeActor | undefined {
    return this.nextLivingActor(runtime, currentActorId);
  }

  private livingEnemies(runtime: CombatRuntime, teamId: string): CombatRuntimeActor[] {
    return runtime.actors.filter((actor) => actor.teamId !== teamId && this.canFight(actor));
  }

  private livingAllies(runtime: CombatRuntime, teamId: string): CombatRuntimeActor[] {
    return runtime.actors.filter((actor) => actor.teamId === teamId && this.canFight(actor));
  }

  private firstLivingActor(runtime: CombatRuntime, teamId: string): CombatRuntimeActor | undefined {
    return runtime.actors.find((actor) => actor.teamId === teamId && this.canFight(actor));
  }

  private opposingTeam(runtime: CombatRuntime, teamId: string) {
    const team = runtime.teams.find((candidate) => candidate.teamId !== teamId);
    if (!team) throw new Error('COMBAT_FORBIDDEN');
    return team;
  }

  private defeatedTeam(runtime: CombatRuntime) {
    return runtime.teams.find((team) => this.isTeamDefeated(runtime, team.teamId));
  }

  private isTeamDefeated(runtime: CombatRuntime, teamId: string): boolean {
    return runtime.actors
      .filter((actor) => actor.teamId === teamId)
      .every((actor) => !this.canFight(actor));
  }

  private canFight(actor: CombatRuntimeActor): boolean {
    return !actor.withdrawn && actor.hp > 0;
  }

  private hasStatus(actor: CombatRuntimeActor, key: string): boolean {
    return Boolean(this.status(actor, key));
  }

  private status(actor: CombatRuntimeActor, key: string): CombatRuntimeStatus | undefined {
    return actor.statuses.find((status) => status.key === key && status.turnsRemaining > 0);
  }

  private removeStatus(actor: CombatRuntimeActor, statusId: string): void {
    actor.statuses = actor.statuses.filter((status) => status.id !== statusId);
  }

  private statusMagnitude(actor: CombatRuntimeActor, key: string): number {
    return actor.statuses
      .filter((status) => status.key === key && status.turnsRemaining > 0)
      .reduce((maximum, status) => Math.max(maximum, status.magnitude ?? 0), 0);
  }

  private primaryPower(actor: CombatRuntimeActor): number {
    switch (actor.characterClass) {
      case 'MAGE':
        return actor.intelligence;
      case 'WARRIOR':
        return actor.strength;
      case 'ARCHER':
        return actor.agility;
    }
  }

  private scalingValue(actor: CombatRuntimeActor, scaling: SkillScalingStat): number {
    switch (scaling) {
      case 'STRENGTH':
        return actor.strength;
      case 'AGILITY':
        return actor.agility;
      case 'INTELLIGENCE':
        return actor.intelligence;
      case 'MAX_HP':
        return actor.maxHp;
    }
  }

  private variance(): number {
    return 0.92 + this.random() * 0.16;
  }

  private toRuntimeActor(
    input: CombatActorInput,
    teamId: string,
    formationSlot: number,
  ): CombatRuntimeActor {
    return {
      ...input,
      teamId,
      formationSlot,
      formationLine: formationLineForSlot(formationSlot),
      magicResistance:
        input.magicResistance ?? Math.max(0, Math.round(input.armor * 0.35)),
      fallbackAction: input.fallbackAction ?? 'DEFEND',
      withdrawn: false,
      controlDrStacks: 0,
      controlDrExpiresTurn: 0,
      statuses: [],
      skills: new Map(
        input.skills.map((skill) => [
          skill.definition.key,
          {
            definition: skill.definition,
            cooldownTurnsRemaining: skill.cooldownTurnsRemaining,
          },
        ]),
      ),
    };
  }

  private assertTeamInput(team: CombatTeamInput): void {
    if (team.actors.length < 1 || team.actors.length > COMBAT_TEAM_LIMIT) {
      throw new Error('COMBAT_ACTION_INVALID');
    }
    if (!team.actors.some((actor) => actor.actorId === team.anchorActorId)) {
      throw new Error('COMBAT_ACTION_INVALID');
    }
    const ids = new Set(team.actors.map((actor) => actor.actorId));
    if (ids.size !== team.actors.length) throw new Error('COMBAT_ACTION_INVALID');
  }

  private assertDistinctTeams(
    first: CombatTeamInput,
    second: CombatTeamInput,
  ): void {
    const firstActorIds = new Set(first.actors.map((actor) => actor.actorId));
    if (second.actors.some((actor) => firstActorIds.has(actor.actorId))) {
      throw new Error('COMBAT_ACTION_INVALID');
    }
  }

  private assertTimingPolicy(policy: CombatTimingPolicy): void {
    const decisionInRange =
      policy.key === 'TUTORIAL' ||
      (policy.decisionMs >= 8_000 && policy.decisionMs <= 12_000);
    if (
      !decisionInRange ||
      policy.reactionMs < 1_000 ||
      policy.disconnectedFallbackMs < 250 ||
      policy.presentationGraceMs < 0
    ) {
      throw new Error('COMBAT_ACTION_INVALID');
    }
  }

  private normalizeTargeting(targeting: SkillTargeting): Exclude<SkillTargeting, 'AREA'> {
    return targeting === 'AREA' ? 'ALL_ENEMIES' : targeting;
  }

  private isSupportSkill(skill: SkillCatalogDefinition | undefined): boolean {
    return Boolean(
      skill &&
        skill.effects.length > 0 &&
        skill.effects.every((effect) =>
          ['HEAL', 'SHIELD', 'CLEANSE', 'TRANSFER_ENERGY'].includes(effect.type),
        ),
    );
  }

  private recordDecisionDuration(runtime: CombatRuntime, now: number): void {
    runtime.decisionDurationsMs.push(Math.max(0, now - (runtime.turnStartedAt ?? now)));
    if (runtime.decisionDurationsMs.length > 512) runtime.decisionDurationsMs.shift();
  }

  private isPvpCombat(runtime: CombatRuntime): boolean {
    return runtime.actors.every((actor) => actor.kind === 'PLAYER');
  }

  private operationFingerprint(actorId: string, command: CombatActionCommand): string {
    return JSON.stringify({
      actorId,
      action: command.action,
      skillKey: command.skillKey ?? null,
      targetActorId: command.targetActorId ?? null,
      expectedTurnNumber: command.expectedTurnNumber ?? null,
      contractVersion: command.contractVersion ?? null,
    });
  }
}
