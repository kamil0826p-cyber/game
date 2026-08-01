import { randomUUID } from 'node:crypto';
import type { CombatTeamPayload } from '../../contracts/group-combat.events.js';
import '../../contracts/tactical-combat.events.js';
import type {
  CombatActionResolutionPayload,
  CombatActionResultPayload,
  CombatFinishReason,
  CombatParticipantPayload,
  CombatSnapshot,
} from '../../contracts/socket.events.js';
import {
  TACTICAL_COMBAT_CONTRACT_VERSION,
  type CombatLegalActionPayload,
  type CombatTelegraphPayload,
  type TacticalCombatAction,
} from '../../contracts/tactical-combat.events.js';
import { applyPrimaryDiminishingReturns } from '../progression/character-stats.js';
import type {
  CombatEffectOperation,
  SkillCatalogDefinition,
  SkillScalingStat,
  SkillTargeting,
} from '../skills/skill.types.js';
import {
  COMBAT_CONTROL_DR_RESET_TURNS,
  COMBAT_EVENT_HISTORY_LIMIT,
  COMBAT_OPERATION_HISTORY_LIMIT,
  COMBAT_TEAM_LIMIT,
  COMBAT_TURN_POLICY,
  defaultFallbackPolicy,
  deterministicFormationSlots,
  formationLineForSlot,
  magicalDamageMultiplier,
  physicalDamageMultiplier,
} from './combat.rules.js';
import type {
  CombatActionCommand,
  CombatActorInput,
  CombatRuntime,
  CombatRuntimeActor,
  CombatRuntimeStatus,
  CombatRuntimeTelegraph,
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
  accentColor: '#d9c28f',
  travelMs: 180,
};

const HARMFUL_STATUS_KEYS = new Set([
  'BURN',
  'BLEED',
  'ROOTED',
  'SLOWED',
  'STUNNED',
  'EXPOSED',
  'MARKED',
  'DAMAGE_TAKEN_INCREASE',
]);

const HARD_CONTROL_KEYS = new Set(['STUNNED']);

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
  ): CombatRuntime {
    this.assertTeamInput(initiators);
    this.assertTeamInput(recipients);
    const firstTeamId = `${combatId}:team-a`;
    const secondTeamId = `${combatId}:team-b`;
    const firstActors = this.toRuntimeActors(initiators.actors, firstTeamId);
    const secondActors = this.toRuntimeActors(recipients.actors, secondTeamId);
    const actorIds = [...firstActors, ...secondActors].map((actor) => actor.actorId);
    if (new Set(actorIds).size !== actorIds.length) throw new Error('COMBAT_ACTION_INVALID');
    return {
      combatId,
      status: 'REQUESTED',
      phase: 'REQUEST',
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
      events: [],
      nextSequence: 1,
      operationReceipts: new Map(),
    };
  }

  start(runtime: CombatRuntime, now: number): CombatSnapshot {
    if (runtime.status !== 'REQUESTED') return this.snapshot(runtime);
    runtime.status = 'ACTIVE';
    runtime.phase = 'TURN';
    runtime.startedAt = now;
    runtime.expiresAt = undefined;
    runtime.turnNumber = 1;
    runtime.turnOrder = [...runtime.actors]
      .map((actor) => ({
        actorId: actor.actorId,
        initiative: applyPrimaryDiminishingReturns(actor.agility) + this.random(),
      }))
      .sort(
        (left, right) =>
          right.initiative - left.initiative || left.actorId.localeCompare(right.actorId),
      )
      .map((entry) => entry.actorId);
    runtime.activeActorId = runtime.turnOrder[0];
    runtime.turnStartedAt = now;
    runtime.turnEndsAt = now + COMBAT_TURN_POLICY.decisionMs;
    return this.snapshot(runtime);
  }

  decline(
    runtime: CombatRuntime,
    reason: Extract<CombatFinishReason, 'DECLINED' | 'REQUEST_EXPIRED' | 'CANCELLED'>,
    now: number,
  ): CombatSnapshot {
    runtime.status =
      reason === 'DECLINED' ? 'DECLINED' : reason === 'REQUEST_EXPIRED' ? 'EXPIRED' : 'CANCELLED';
    runtime.phase = 'FINISHED';
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
    runtime.phase = 'FINISHED';
    runtime.finishReason = reason;
    runtime.finishedAt = now;
    runtime.activeActorId = undefined;
    runtime.turnStartedAt = undefined;
    runtime.turnEndsAt = undefined;
    runtime.telegraph = undefined;
    return this.snapshot(runtime);
  }

  act(
    runtime: CombatRuntime,
    actorId: string,
    command: CombatActionCommand,
    now: number,
  ): CombatSnapshot {
    if (runtime.status !== 'ACTIVE') throw new Error('COMBAT_NOT_ACTIVE');
    const operationId = command.operationId ?? command.requestId;
    const fingerprint = this.commandFingerprint(actorId, command);
    if (operationId) {
      const replay = runtime.operationReceipts.get(operationId);
      if (replay) {
        if (replay.fingerprint !== fingerprint) throw new Error('COMBAT_OPERATION_ID_COLLISION');
        return replay.snapshot;
      }
    }
    if (command.expectedTurn !== undefined && command.expectedTurn !== runtime.turnNumber) {
      throw new Error('COMBAT_STALE_TURN');
    }

    const actor = this.actor(runtime, actorId);
    if (!this.canAct(actor)) throw new Error('COMBAT_FORBIDDEN');

    let snapshot: CombatSnapshot;
    if (runtime.telegraph && now >= runtime.telegraph.closesAt) {
      if (runtime.telegraph.actorId !== actorId) throw new Error('COMBAT_REACTION_CLOSED');
      snapshot = this.resolveTelegraph(runtime, now);
    } else if (runtime.phase === 'REACTION') {
      snapshot = this.resolveReaction(runtime, actor, command, now);
    } else {
      if (runtime.activeActorId !== actorId) throw new Error('COMBAT_NOT_YOUR_TURN');
      const timedOut = Boolean(
        command.timedOut ||
          (actor.kind === 'PLAYER' && runtime.turnEndsAt !== undefined && now >= runtime.turnEndsAt),
      );
      snapshot = timedOut
        ? this.resolveTimeout(runtime, actor, now)
        : this.resolveTurnAction(runtime, actor, command, now, false);
    }

    if (operationId) this.storeReceipt(runtime, operationId, fingerprint, snapshot);
    return snapshot;
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
    this.clearProtection(runtime, actor.actorId);
    if (runtime.telegraph?.actorId === actorId || runtime.telegraph?.targetActorIds.includes(actorId)) {
      runtime.telegraph = undefined;
      runtime.phase = 'TURN';
    }
    const winningTeam = this.opposingTeam(runtime, actor.teamId);
    if (this.isTeamDefeated(runtime, actor.teamId)) {
      const winner = this.firstLivingActor(runtime, winningTeam.teamId);
      return this.finish(runtime, winningTeam.teamId, winner?.actorId, reason, now);
    }
    if (runtime.activeActorId === actorId) return this.advance(runtime, now);
    return this.snapshot(runtime);
  }

  snapshot(runtime: CombatRuntime): CombatSnapshot {
    const telegraph = runtime.telegraph ? this.publicTelegraph(runtime.telegraph) : undefined;
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
      recentActions: runtime.events.map((event) => ({
        ...event,
        results: event.results.map((result) => ({
          ...result,
          statusesApplied: result.statusesApplied.map((status) => ({ ...status })),
          statusesRemoved: [...result.statusesRemoved],
          ...(result.statusesCleansed ? { statusesCleansed: [...result.statusesCleansed] } : {}),
        })),
      })),
      contractVersion: TACTICAL_COMBAT_CONTRACT_VERSION,
      phase: runtime.phase,
      turnOrder: [...runtime.turnOrder],
      lastSequence: runtime.nextSequence - 1,
      turnPolicy: { ...COMBAT_TURN_POLICY },
      ...(telegraph ? { telegraph } : {}),
      legalActions: this.legalActions(runtime),
    };
  }

  legalTargetIds(
    runtime: CombatRuntime,
    actorId: string,
    targeting: SkillTargeting | 'BASIC_ATTACK',
  ): string[] {
    const actor = this.actor(runtime, actorId);
    const allies = this.livingActors(runtime, actor.teamId);
    const enemies = runtime.actors.filter(
      (candidate) => candidate.teamId !== actor.teamId && this.canAct(candidate),
    );
    const livingFrontEnemies = enemies.filter((candidate) => candidate.formationLine === 'FRONT');
    const accessibleEnemies = livingFrontEnemies.length > 0 ? livingFrontEnemies : enemies;
    switch (targeting) {
      case 'SELF':
        return [actor.actorId];
      case 'ALLY':
        return allies.map((candidate) => candidate.actorId);
      case 'ALL_ALLIES':
        return allies.map((candidate) => candidate.actorId);
      case 'AREA':
      case 'ALL_ENEMIES':
        return enemies.map((candidate) => candidate.actorId);
      case 'FRONT_ROW':
        return accessibleEnemies.map((candidate) => candidate.actorId);
      case 'BACK_ROW':
        return livingFrontEnemies.length > 0
          ? []
          : enemies
              .filter((candidate) => candidate.formationLine === 'BACK')
              .map((candidate) => candidate.actorId);
      case 'ADJACENT':
        return allies
          .filter(
            (candidate) =>
              candidate.actorId !== actor.actorId &&
              (Math.abs(candidate.formationSlot - actor.formationSlot) === 1 ||
                Math.abs(candidate.formationSlot - actor.formationSlot) === 5),
          )
          .map((candidate) => candidate.actorId);
      case 'BASIC_ATTACK':
      case 'ENEMY':
        return accessibleEnemies.map((candidate) => candidate.actorId);
    }
  }

  private resolveTurnAction(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    command: CombatActionCommand,
    now: number,
    timedOut: boolean,
  ): CombatSnapshot {
    switch (command.action) {
      case 'GUARD':
      case 'INTERCEPT':
      case 'CLEANSE':
      case 'SWAP':
      case 'SUPPORT_ENERGY':
      case 'SKIP':
        return this.resolveTacticalTurnAction(runtime, actor, command, now, timedOut);
      case 'INTERRUPT':
        throw new Error('COMBAT_ACTION_INVALID');
      case 'BASIC_ATTACK':
      case 'SKILL':
        return this.resolveOffensiveAction(runtime, actor, command, now, timedOut);
    }
  }

  private resolveOffensiveAction(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    command: CombatActionCommand,
    now: number,
    timedOut: boolean,
  ): CombatSnapshot {
    const usedSkill = command.action === 'SKILL' ? this.requireSkill(actor, command.skillKey) : undefined;
    if (usedSkill?.cooldownTurnsRemaining) throw new Error('COMBAT_SKILL_COOLDOWN');
    if (usedSkill && actor.energy < usedSkill.definition.energyCost) {
      throw new Error('COMBAT_INSUFFICIENT_ENERGY');
    }
    const targets = this.actionTargets(runtime, actor, usedSkill?.definition, command.targetActorId);
    if (usedSkill?.definition.telegraph) {
      actor.energy -= usedSkill.definition.energyCost;
      this.decrementCooldowns(actor);
      usedSkill.cooldownTurnsRemaining = usedSkill.definition.cooldownTurns;
      runtime.telegraph = {
        id: randomUUID(),
        actorId: actor.actorId,
        skillKey: usedSkill.definition.key,
        label: usedSkill.definition.name,
        targetActorIds: targets.map((target) => target.actorId),
        declaredAt: now,
        closesAt: now + usedSkill.definition.telegraph.reactionWindowMs,
        interruptible: usedSkill.definition.telegraph.interruptible,
        counters: [...usedSkill.definition.telegraph.counters],
        publicIntent: usedSkill.definition.telegraph.publicIntent,
        reactedByActorIds: new Set(),
        command: { ...command },
        interrupted: false,
        guardedTargetActorIds: new Set(),
      };
      runtime.phase = 'REACTION';
      runtime.turnEndsAt = runtime.telegraph.closesAt;
      this.appendEvent(runtime, {
        actorId: actor.actorId,
        targetActorId: targets[0]?.actorId,
        action: 'SKILL',
        skillKey: usedSkill.definition.key,
        tacticalAction: 'TELEGRAPH_DECLARED',
        label: `${usedSkill.definition.name}: telegraph`,
        animationKey: `${usedSkill.definition.animationKey}:telegraph`,
        visual: usedSkill.definition.visual,
        results: targets.map((target) => this.emptyResult(target.actorId)),
        occurredAt: now,
        decisionTimeMs: this.decisionTime(runtime, now),
        timedOut,
        operationId: command.operationId ?? command.requestId,
      });
      return this.snapshot(runtime);
    }

    if (usedSkill) actor.energy -= usedSkill.definition.energyCost;
    const results = targets.map((target) => this.emptyResult(target.actorId));
    if (usedSkill) {
      targets.forEach((target, index) =>
        this.resolveSkill(runtime, actor, target, usedSkill.definition, results[index]!),
      );
    } else {
      this.resolveBasicAttack(runtime, actor, targets[0]!, results[0]!);
    }
    this.decrementCooldowns(actor);
    if (usedSkill) usedSkill.cooldownTurnsRemaining = usedSkill.definition.cooldownTurns;
    this.decrementStatuses(actor, runtime.turnNumber);
    this.appendEvent(runtime, {
      actorId: actor.actorId,
      targetActorId: targets[0]?.actorId,
      action: usedSkill ? 'SKILL' : 'BASIC_ATTACK',
      skillKey: usedSkill?.definition.key,
      label: usedSkill?.definition.name ?? 'Basic attack',
      animationKey: usedSkill?.definition.animationKey ?? 'basic-attack',
      visual: usedSkill?.definition.visual ?? BASIC_ATTACK_VISUAL,
      results,
      occurredAt: now,
      decisionTimeMs: this.decisionTime(runtime, now),
      timedOut,
      operationId: command.operationId ?? command.requestId,
    });
    return this.afterAction(runtime, actor, now);
  }

  private resolveTacticalTurnAction(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    command: CombatActionCommand,
    now: number,
    timedOut: boolean,
  ): CombatSnapshot {
    const results: CombatActionResultPayload[] = [];
    switch (command.action) {
      case 'GUARD': {
        actor.guarding = true;
        results.push(this.emptyResult(actor.actorId));
        break;
      }
      case 'INTERCEPT': {
        const target = this.requireLivingAlly(runtime, actor, command.targetActorId);
        if (target.actorId === actor.actorId) throw new Error('COMBAT_ACTION_INVALID');
        this.clearProtection(runtime, actor.actorId);
        actor.protectedActorId = target.actorId;
        target.protectedByActorId = actor.actorId;
        results.push(this.emptyResult(target.actorId));
        break;
      }
      case 'CLEANSE': {
        const target = this.requireLivingAlly(runtime, actor, command.targetActorId ?? actor.actorId);
        const result = this.emptyResult(target.actorId);
        result.statusesCleansed = this.cleanse(target, 2);
        result.statusesRemoved.push(...result.statusesCleansed);
        results.push(result);
        break;
      }
      case 'SWAP': {
        const target = this.requireLivingAlly(runtime, actor, command.targetActorId);
        if (target.actorId === actor.actorId) throw new Error('COMBAT_ACTION_INVALID');
        const slot = actor.formationSlot;
        actor.formationSlot = target.formationSlot;
        target.formationSlot = slot;
        actor.formationLine = formationLineForSlot(actor.formationSlot);
        target.formationLine = formationLineForSlot(target.formationSlot);
        results.push(this.emptyResult(target.actorId));
        break;
      }
      case 'SUPPORT_ENERGY': {
        const target = this.requireLivingAlly(runtime, actor, command.targetActorId);
        if (target.actorId === actor.actorId) throw new Error('COMBAT_ACTION_INVALID');
        const amount = Math.min(20, actor.energy, Math.max(0, target.maxEnergy - target.energy));
        if (amount <= 0) throw new Error('COMBAT_ACTION_INVALID');
        actor.energy -= amount;
        target.energy += amount;
        const actorResult = this.emptyResult(actor.actorId);
        actorResult.energyDelta = -amount;
        const targetResult = this.emptyResult(target.actorId);
        targetResult.energyDelta = amount;
        results.push(actorResult, targetResult);
        break;
      }
      case 'SKIP':
        results.push(this.emptyResult(actor.actorId));
        break;
      default:
        throw new Error('COMBAT_ACTION_INVALID');
    }
    this.decrementCooldowns(actor);
    this.decrementStatuses(actor, runtime.turnNumber);
    this.appendTacticalEvent(runtime, actor, command.action, command, results, now, timedOut);
    return this.afterAction(runtime, actor, now);
  }

  private resolveReaction(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    command: CombatActionCommand,
    now: number,
  ): CombatSnapshot {
    const telegraph = runtime.telegraph;
    if (!telegraph || now >= telegraph.closesAt) throw new Error('COMBAT_REACTION_CLOSED');
    const source = this.actor(runtime, telegraph.actorId);
    if (actor.teamId === source.teamId) throw new Error('COMBAT_FORBIDDEN');
    if (telegraph.reactedByActorIds.has(actor.actorId)) throw new Error('COMBAT_ACTION_INVALID');
    const results: CombatActionResultPayload[] = [];
    switch (command.action) {
      case 'INTERRUPT': {
        if (
          command.telegraphId !== telegraph.id ||
          !telegraph.interruptible ||
          !telegraph.counters.includes('INTERRUPT')
        ) throw new Error('COMBAT_ACTION_INVALID');
        telegraph.interrupted = true;
        const stagger = this.addStatus(runtime, actor, source, {
          type: 'APPLY_STATUS',
          statusKey: 'STAGGER',
          durationTurns: 1,
          magnitude: 0.15,
          harmful: true,
        });
        const result = this.emptyResult(source.actorId);
        if (stagger) result.statusesApplied.push(this.statusPayload(stagger));
        result.reactionChangedOutcome = true;
        results.push(result);
        telegraph.reactedByActorIds.add(actor.actorId);
        this.appendTacticalEvent(runtime, actor, 'INTERRUPT', command, results, now, false, telegraph.id);
        runtime.telegraph = undefined;
        runtime.phase = 'TURN';
        return this.advance(runtime, now);
      }
      case 'GUARD': {
        if (!telegraph.counters.includes('GUARD')) throw new Error('COMBAT_ACTION_INVALID');
        if (!telegraph.targetActorIds.includes(actor.actorId)) throw new Error('COMBAT_FORBIDDEN');
        actor.guarding = true;
        telegraph.guardedTargetActorIds.add(actor.actorId);
        results.push(this.emptyResult(actor.actorId));
        break;
      }
      case 'INTERCEPT': {
        if (!telegraph.counters.includes('INTERCEPT')) throw new Error('COMBAT_ACTION_INVALID');
        const target = this.requireLivingAlly(runtime, actor, command.targetActorId);
        if (!telegraph.targetActorIds.includes(target.actorId) || target.actorId === actor.actorId) {
          throw new Error('COMBAT_ACTION_INVALID');
        }
        this.clearProtection(runtime, actor.actorId);
        actor.protectedActorId = target.actorId;
        target.protectedByActorId = actor.actorId;
        results.push(this.emptyResult(target.actorId));
        break;
      }
      case 'CLEANSE': {
        if (!telegraph.counters.includes('CLEANSE')) throw new Error('COMBAT_ACTION_INVALID');
        const target = this.requireLivingAlly(runtime, actor, command.targetActorId ?? actor.actorId);
        const result = this.emptyResult(target.actorId);
        result.statusesCleansed = this.cleanse(target, 1);
        result.statusesRemoved.push(...result.statusesCleansed);
        results.push(result);
        break;
      }
      default:
        throw new Error('COMBAT_ACTION_INVALID');
    }
    telegraph.reactedByActorIds.add(actor.actorId);
    this.appendTacticalEvent(
      runtime,
      actor,
      command.action,
      command,
      results,
      now,
      false,
      telegraph.id,
    );
    return this.snapshot(runtime);
  }

  private resolveTelegraph(runtime: CombatRuntime, now: number): CombatSnapshot {
    const telegraph = runtime.telegraph;
    if (!telegraph) throw new Error('COMBAT_ACTION_INVALID');
    const actor = this.actor(runtime, telegraph.actorId);
    const skill = this.requireSkill(actor, telegraph.skillKey).definition;
    if (telegraph.interrupted) {
      runtime.telegraph = undefined;
      runtime.phase = 'TURN';
      return this.advance(runtime, now);
    }
    const targets = telegraph.targetActorIds
      .map((targetId) => runtime.actors.find((candidate) => candidate.actorId === targetId))
      .filter((target): target is CombatRuntimeActor => Boolean(target && this.canAct(target)));
    const results = targets.map((target) => this.emptyResult(target.actorId));
    targets.forEach((target, index) => this.resolveSkill(runtime, actor, target, skill, results[index]!));
    this.appendEvent(runtime, {
      actorId: actor.actorId,
      targetActorId: targets[0]?.actorId,
      action: 'SKILL',
      skillKey: skill.key,
      tacticalAction: 'TELEGRAPH_RESOLVED',
      label: skill.name,
      animationKey: skill.animationKey,
      visual: skill.visual,
      results,
      occurredAt: now,
      decisionTimeMs: Math.max(0, telegraph.closesAt - telegraph.declaredAt),
      timedOut: false,
      reactionToTelegraphId: telegraph.id,
    });
    runtime.telegraph = undefined;
    runtime.phase = 'TURN';
    this.decrementStatuses(actor, runtime.turnNumber);
    return this.afterAction(runtime, actor, now);
  }

  private resolveTimeout(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    now: number,
  ): CombatSnapshot {
    const fallback = actor.fallbackPolicy;
    if (fallback === 'BASIC_ATTACK') {
      const target = this.legalTargetIds(runtime, actor.actorId, 'BASIC_ATTACK')[0];
      if (target) {
        return this.resolveTurnAction(
          runtime,
          actor,
          { action: 'BASIC_ATTACK', targetActorId: target, timedOut: true },
          now,
          true,
        );
      }
    }
    return this.resolveTacticalTurnAction(
      runtime,
      actor,
      { action: fallback === 'SKIP' ? 'SKIP' : 'GUARD', timedOut: true },
      now,
      true,
    );
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
    const guardLimit = Math.max(4, runtime.actors.length * 3);
    runtime.phase = 'TURN';
    runtime.telegraph = undefined;
    for (let guard = 0; guard < guardLimit; guard += 1) {
      const next = this.nextLivingActor(runtime, runtime.activeActorId);
      if (!next) return this.terminate(runtime, 'CANCELLED', now);
      runtime.turnNumber += 1;
      runtime.activeActorId = next.actorId;
      runtime.turnStartedAt = now;
      runtime.turnEndsAt = now + COMBAT_TURN_POLICY.decisionMs;

      const turnResults = this.beginTurn(runtime, next);
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
      const defeatedTeam = this.defeatedTeam(runtime);
      if (defeatedTeam) {
        const winner = this.opposingTeam(runtime, defeatedTeam.teamId);
        const winnerActor = this.firstLivingActor(runtime, winner.teamId);
        return this.finish(runtime, winner.teamId, winnerActor?.actorId, 'DEFEATED', now);
      }
      if (!this.canAct(next)) continue;
      if (!this.hasStatus(next, 'STUNNED')) return this.snapshot(runtime);
      const skipped = this.emptyResult(next.actorId);
      skipped.statusesRemoved = this.decrementStatuses(next, runtime.turnNumber);
      this.decrementCooldowns(next);
      this.appendEvent(runtime, {
        actorId: next.actorId,
        targetActorId: next.actorId,
        action: 'TURN_SKIPPED',
        tacticalAction: 'SKIP',
        label: 'Turn skipped: stunned',
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

  private beginTurn(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
  ): CombatActionResultPayload | undefined {
    actor.guarding = false;
    this.clearProtection(runtime, actor.actorId);
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

  private actionTargets(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    skill: SkillCatalogDefinition | undefined,
    targetActorId: string | undefined,
  ): CombatRuntimeActor[] {
    const targeting = skill?.targeting ?? 'BASIC_ATTACK';
    const legalIds = this.legalTargetIds(runtime, actor.actorId, targeting);
    if (legalIds.length === 0) throw new Error('COMBAT_TARGET_ILLEGAL');
    if (['AREA', 'ALL_ENEMIES', 'ALL_ALLIES', 'FRONT_ROW'].includes(targeting)) {
      return legalIds.map((id) => this.actor(runtime, id));
    }
    if (targeting === 'SELF') return [actor];
    const selectedId = targetActorId ?? legalIds[0];
    if (!selectedId || !legalIds.includes(selectedId)) throw new Error('COMBAT_TARGET_ILLEGAL');
    return [this.actor(runtime, selectedId)];
  }

  private resolveBasicAttack(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    result: CombatActionResultPayload,
  ): void {
    const primary = this.primaryPower(actor);
    const raw = 5 + actor.level * 1.5 + primary * 1.15;
    this.applyDamage(runtime, actor, target, raw, 'PHYSICAL', 0, result);
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
          effect.targetHpBelow !== undefined && target.hp / Math.max(1, target.maxHp) < effect.targetHpBelow
            ? effect.bonusCoefficient ?? 0
            : 0;
        const consumed = effect.consumesStatusKey
          ? target.statuses.find((status) => status.key === effect.consumesStatusKey)
          : undefined;
        const comboBonus = consumed ? 0.35 : 0;
        if (consumed) {
          target.statuses = target.statuses.filter((status) => status.id !== consumed.id);
          result.statusesRemoved.push(consumed.key);
        }
        const raw = 5 + actor.level * 1.25 + scaling * (effect.coefficient + thresholdBonus + comboBonus);
        this.applyDamage(
          runtime,
          actor,
          target,
          raw,
          effect.damageType,
          effect.armorPenetration ?? 0,
          result,
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
        const status = this.addStatus(runtime, actor, target, {
          type: 'APPLY_STATUS',
          statusKey: 'SHIELD',
          durationTurns: effect.durationTurns,
          magnitude: amount,
          harmful: false,
        });
        result.shieldDelta += amount;
        if (status) result.statusesApplied.push(this.statusPayload(status));
        break;
      }
      case 'APPLY_STATUS': {
        if (effect.chance !== undefined && this.random() > effect.chance) break;
        const status = this.addStatus(runtime, actor, target, effect);
        if (status) result.statusesApplied.push(this.statusPayload(status));
        else result.statusResisted = effect.statusKey;
        break;
      }
      case 'CLEANSE': {
        result.statusesCleansed = this.cleanse(target, effect.maximumStatuses ?? 1);
        result.statusesRemoved.push(...result.statusesCleansed);
        break;
      }
      case 'ENERGY_TRANSFER': {
        const amount = Math.min(
          Math.max(0, Math.floor(effect.amount)),
          actor.energy,
          Math.max(0, target.maxEnergy - target.energy),
        );
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
  ): void {
    let target = originalTarget;
    const protector = originalTarget.protectedByActorId
      ? runtime.actors.find(
          (candidate) =>
            candidate.actorId === originalTarget.protectedByActorId && this.canAct(candidate),
        )
      : undefined;
    if (protector) {
      result.redirectedFromActorId = originalTarget.actorId;
      result.targetActorId = protector.actorId;
      result.reactionChangedOutcome = true;
      target = protector;
    }
    const rooted = this.hasStatus(target, 'ROOTED');
    const dodgeChance = rooted ? 0 : this.statusMagnitude(target, 'DODGE');
    if (dodgeChance > 0 && this.random() < dodgeChance) {
      result.dodged = true;
      return;
    }
    const outgoing =
      1 +
      this.statusMagnitude(actor, 'DAMAGE_INCREASE') +
      this.statusMagnitude(actor, 'HASTE') * 0.1 -
      this.statusMagnitude(actor, 'SLOWED') * 0.1;
    const exposed = this.hasStatus(target, 'EXPOSED');
    const incoming =
      1 -
      this.statusMagnitude(target, 'DAMAGE_REDUCTION') +
      this.statusMagnitude(target, 'DAMAGE_TAKEN_INCREASE') +
      (rooted ? 0.1 : 0) +
      (exposed ? 0.25 : 0);
    const mitigation =
      damageType === 'PHYSICAL'
        ? physicalDamageMultiplier(target.armor, armorPenetration)
        : magicalDamageMultiplier(target.armor);
    const guardMultiplier = target.guarding ? 0.6 : 1;
    const interceptMultiplier = protector ? 0.8 : 1;
    let damage = Math.max(
      1,
      Math.round(
        rawDamage *
          Math.max(0.1, outgoing) *
          Math.max(0.1, incoming) *
          mitigation *
          guardMultiplier *
          interceptMultiplier *
          this.variance(),
      ),
    );
    if (exposed) {
      target.statuses = target.statuses.filter((status) => status.key !== 'EXPOSED');
      result.statusesRemoved.push('EXPOSED');
    }
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
  }

  private addStatus(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    effect: Extract<CombatEffectOperation, { type: 'APPLY_STATUS' }>,
  ): CombatRuntimeStatus | undefined {
    const hardControl = effect.hardControl ?? HARD_CONTROL_KEYS.has(effect.statusKey);
    let durationTurns = Math.max(1, Math.floor(effect.durationTurns));
    if (hardControl && runtime.zoneType === 'PVP') {
      if (
        runtime.turnNumber - target.controlHistory.lastAppliedTurn >
        COMBAT_CONTROL_DR_RESET_TURNS
      ) {
        target.controlHistory = { applications: 0, lastAppliedTurn: runtime.turnNumber };
      }
      const multipliers = [1, 0.5, 0.25, 0] as const;
      const multiplier = multipliers[Math.min(3, target.controlHistory.applications)]!;
      target.controlHistory.applications += 1;
      target.controlHistory.lastAppliedTurn = runtime.turnNumber;
      if (multiplier === 0) return undefined;
      durationTurns = Math.max(1, Math.ceil(durationTurns * multiplier));
    }
    const existing = target.statuses.find(
      (status) => status.key === effect.statusKey && status.sourceActorId === actor.actorId,
    );
    if (existing) {
      existing.turnsRemaining = Math.max(existing.turnsRemaining, durationTurns);
      existing.magnitude = Math.max(existing.magnitude ?? 0, effect.magnitude ?? 0);
      existing.sourcePower = this.primaryPower(actor);
      existing.appliedTurn = runtime.turnNumber;
      existing.harmful = effect.harmful ?? HARMFUL_STATUS_KEYS.has(effect.statusKey);
      existing.hardControl = hardControl;
      return existing;
    }
    const status: CombatRuntimeStatus = {
      id: randomUUID(),
      key: effect.statusKey,
      turnsRemaining: durationTurns,
      magnitude: effect.magnitude,
      sourceActorId: actor.actorId,
      sourcePower: this.primaryPower(actor),
      appliedTurn: runtime.turnNumber,
      harmful: effect.harmful ?? HARMFUL_STATUS_KEYS.has(effect.statusKey),
      hardControl,
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
    runtime.phase = 'FINISHED';
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

  private legalActions(runtime: CombatRuntime): CombatLegalActionPayload[] {
    if (runtime.status !== 'ACTIVE') return [];
    const actors = runtime.actors.filter((actor) => this.canAct(actor));
    if (runtime.phase === 'REACTION' && runtime.telegraph) {
      const source = this.actor(runtime, runtime.telegraph.actorId);
      return actors
        .filter(
          (actor) =>
            actor.teamId !== source.teamId &&
            !runtime.telegraph!.reactedByActorIds.has(actor.actorId),
        )
        .map((actor) => ({
          actorId: actor.actorId,
          turnNumber: runtime.turnNumber,
          actions: [
            ...(runtime.telegraph!.interruptible &&
            runtime.telegraph!.counters.includes('INTERRUPT')
              ? [{
                  action: 'INTERRUPT' as const,
                  targetActorIds: [source.actorId],
                  usableDuringReaction: true,
                }]
              : []),
            ...(runtime.telegraph!.counters.includes('GUARD') &&
            runtime.telegraph!.targetActorIds.includes(actor.actorId)
              ? [{
                  action: 'GUARD' as const,
                  targetActorIds: [actor.actorId],
                  usableDuringReaction: true,
                }]
              : []),
            ...(runtime.telegraph!.counters.includes('INTERCEPT')
              ? [{
                  action: 'INTERCEPT' as const,
                  targetActorIds: this.livingActors(runtime, actor.teamId)
                    .filter((target) => runtime.telegraph!.targetActorIds.includes(target.actorId))
                    .map((target) => target.actorId),
                  usableDuringReaction: true,
                }]
              : []),
            ...(runtime.telegraph!.counters.includes('CLEANSE')
              ? [{
                  action: 'CLEANSE' as const,
                  targetActorIds: this.livingActors(runtime, actor.teamId).map(
                    (target) => target.actorId,
                  ),
                  usableDuringReaction: true,
                }]
              : []),
          ],
        }))
        .filter((entry) => entry.actions.length > 0);
    }
    const actor = runtime.activeActorId ? this.actor(runtime, runtime.activeActorId) : undefined;
    if (!actor || !this.canAct(actor)) return [];
    return [
      {
        actorId: actor.actorId,
        turnNumber: runtime.turnNumber,
        actions: [
          {
            action: 'BASIC_ATTACK',
            targetActorIds: this.legalTargetIds(runtime, actor.actorId, 'BASIC_ATTACK'),
          },
          { action: 'GUARD', targetActorIds: [actor.actorId] },
          {
            action: 'INTERCEPT',
            targetActorIds: this.livingActors(runtime, actor.teamId)
              .filter((target) => target.actorId !== actor.actorId)
              .map((target) => target.actorId),
          },
          {
            action: 'CLEANSE',
            targetActorIds: this.livingActors(runtime, actor.teamId).map(
              (target) => target.actorId,
            ),
          },
          {
            action: 'SWAP',
            targetActorIds: this.livingActors(runtime, actor.teamId)
              .filter((target) => target.actorId !== actor.actorId)
              .map((target) => target.actorId),
          },
          {
            action: 'SUPPORT_ENERGY',
            targetActorIds: this.livingActors(runtime, actor.teamId)
              .filter((target) => target.actorId !== actor.actorId)
              .map((target) => target.actorId),
          },
          { action: 'SKIP', targetActorIds: [actor.actorId] },
          ...[...actor.skills.values()].map((skill) => ({
            action: 'SKILL' as const,
            skillKey: skill.definition.key,
            targetActorIds: this.legalTargetIds(
              runtime,
              actor.actorId,
              skill.definition.targeting,
            ),
            ...(skill.cooldownTurnsRemaining > 0 || actor.energy < skill.definition.energyCost
              ? { reason: 'UNAVAILABLE' }
              : {}),
          })),
        ],
      },
    ];
  }

  private appendTacticalEvent(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    action: TacticalCombatAction,
    command: CombatActionCommand,
    results: CombatActionResultPayload[],
    now: number,
    timedOut: boolean,
    reactionToTelegraphId?: string,
  ): void {
    const labels: Record<TacticalCombatAction, string> = {
      GUARD: 'Guard',
      INTERCEPT: 'Intercept',
      INTERRUPT: 'Interrupt',
      CLEANSE: 'Cleanse',
      SWAP: 'Swap formation',
      SUPPORT_ENERGY: 'Transfer energy',
      SKIP: 'Hold position',
    };
    this.appendEvent(runtime, {
      actorId: actor.actorId,
      targetActorId: results[0]?.targetActorId,
      action: action === 'SKIP' ? 'TURN_SKIPPED' : 'SKILL',
      skillKey: `tactical:${action.toLowerCase()}`,
      tacticalAction: action,
      label: labels[action],
      animationKey: `tactical-${action.toLowerCase()}`,
      visual: TACTICAL_VISUAL,
      results,
      occurredAt: now,
      decisionTimeMs: this.decisionTime(runtime, now),
      timedOut,
      operationId: command.operationId ?? command.requestId,
      reactionToTelegraphId,
    });
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

  private appendEvent(
    runtime: CombatRuntime,
    event: Omit<CombatActionResolutionPayload, 'sequence'>,
  ): void {
    runtime.events.push({ ...event, sequence: runtime.nextSequence++ });
    if (runtime.events.length > COMBAT_EVENT_HISTORY_LIMIT) {
      runtime.events.splice(0, runtime.events.length - COMBAT_EVENT_HISTORY_LIMIT);
    }
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
    const resistanceApplications = Math.min(3, actor.controlHistory.applications);
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
      fallbackPolicy: actor.fallbackPolicy,
      guarding: actor.guarding,
      protectedActorId: actor.protectedActorId,
      protectedByActorId: actor.protectedByActorId,
      controlResistanceBasisPoints: resistanceApplications * 2_500,
    };
  }

  private statusPayload(status: CombatRuntimeStatus) {
    return {
      key: status.key,
      turnsRemaining: status.turnsRemaining,
      magnitude: status.magnitude,
    };
  }

  private publicTelegraph(telegraph: CombatRuntimeTelegraph): CombatTelegraphPayload {
    return {
      id: telegraph.id,
      actorId: telegraph.actorId,
      skillKey: telegraph.skillKey,
      label: telegraph.label,
      targetActorIds: [...telegraph.targetActorIds],
      declaredAt: telegraph.declaredAt,
      closesAt: telegraph.closesAt,
      interruptible: telegraph.interruptible,
      counters: [...telegraph.counters],
      publicIntent: telegraph.publicIntent,
      reactedByActorIds: [...telegraph.reactedByActorIds],
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

  private requireLivingAlly(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    targetActorId?: string,
  ): CombatRuntimeActor {
    if (!targetActorId) throw new Error('COMBAT_ACTION_INVALID');
    const target = this.actor(runtime, targetActorId);
    if (target.teamId !== actor.teamId || !this.canAct(target)) {
      throw new Error('COMBAT_TARGET_ILLEGAL');
    }
    return target;
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
      if (actor && this.canAct(actor)) return actor;
    }
    return undefined;
  }

  private livingActors(runtime: CombatRuntime, teamId: string): CombatRuntimeActor[] {
    return runtime.actors.filter((actor) => actor.teamId === teamId && this.canAct(actor));
  }

  private firstLivingActor(
    runtime: CombatRuntime,
    teamId: string,
  ): CombatRuntimeActor | undefined {
    return runtime.actors.find((actor) => actor.teamId === teamId && this.canAct(actor));
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
      .every((actor) => !this.canAct(actor));
  }

  private canAct(actor: CombatRuntimeActor): boolean {
    return !actor.withdrawn && actor.hp > 0;
  }

  private hasStatus(actor: CombatRuntimeActor, key: string): boolean {
    return actor.statuses.some((status) => status.key === key && status.turnsRemaining > 0);
  }

  private statusMagnitude(actor: CombatRuntimeActor, key: string): number {
    return actor.statuses
      .filter((status) => status.key === key && status.turnsRemaining > 0)
      .reduce((maximum, status) => Math.max(maximum, status.magnitude ?? 0), 0);
  }

  private primaryPower(actor: CombatRuntimeActor): number {
    switch (actor.characterClass) {
      case 'MAGE':
        return applyPrimaryDiminishingReturns(actor.intelligence);
      case 'WARRIOR':
        return applyPrimaryDiminishingReturns(actor.strength);
      case 'ARCHER':
        return applyPrimaryDiminishingReturns(actor.agility);
    }
  }

  private scalingValue(actor: CombatRuntimeActor, scaling: SkillScalingStat): number {
    switch (scaling) {
      case 'STRENGTH':
        return applyPrimaryDiminishingReturns(actor.strength);
      case 'AGILITY':
        return applyPrimaryDiminishingReturns(actor.agility);
      case 'INTELLIGENCE':
        return applyPrimaryDiminishingReturns(actor.intelligence);
      case 'MAX_HP':
        return actor.maxHp;
    }
  }

  private variance(): number {
    return 0.92 + this.random() * 0.16;
  }

  private toRuntimeActors(
    inputs: readonly CombatActorInput[],
    teamId: string,
  ): CombatRuntimeActor[] {
    const defaultSlots = deterministicFormationSlots(inputs.length);
    const usedSlots = new Set<number>();
    return inputs.map((input, index) => {
      const formationSlot = input.formationSlot ?? defaultSlots[index]!;
      if (usedSlots.has(formationSlot)) throw new Error('COMBAT_FORMATION_INVALID');
      usedSlots.add(formationSlot);
      return {
        ...input,
        teamId,
        formationSlot,
        formationLine: formationLineForSlot(formationSlot),
        fallbackPolicy: input.fallbackPolicy ?? defaultFallbackPolicy(input.kind),
        withdrawn: false,
        guarding: false,
        statuses: [],
        controlHistory: { applications: 0, lastAppliedTurn: -COMBAT_CONTROL_DR_RESET_TURNS },
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
    });
  }

  private assertTeamInput(team: CombatTeamInput): void {
    if (team.actors.length < 1 || team.actors.length > COMBAT_TEAM_LIMIT) {
      throw new Error('COMBAT_ACTION_INVALID');
    }
    if (!team.actors.some((actor) => actor.actorId === team.anchorActorId)) {
      throw new Error('COMBAT_ACTION_INVALID');
    }
    const explicitSlots = team.actors
      .map((actor) => actor.formationSlot)
      .filter((slot): slot is number => slot !== undefined);
    if (
      explicitSlots.some(
        (slot) => !Number.isInteger(slot) || slot < 0 || slot >= COMBAT_TEAM_LIMIT,
      ) ||
      new Set(explicitSlots).size !== explicitSlots.length
    ) {
      throw new Error('COMBAT_FORMATION_INVALID');
    }
  }

  private clearProtection(runtime: CombatRuntime, actorId: string): void {
    const actor = runtime.actors.find((candidate) => candidate.actorId === actorId);
    if (actor?.protectedActorId) {
      const protectedActor = runtime.actors.find(
        (candidate) => candidate.actorId === actor.protectedActorId,
      );
      if (protectedActor?.protectedByActorId === actorId) {
        protectedActor.protectedByActorId = undefined;
      }
      actor.protectedActorId = undefined;
    }
    for (const candidate of runtime.actors) {
      if (candidate.protectedByActorId === actorId) candidate.protectedByActorId = undefined;
    }
  }

  private cleanse(actor: CombatRuntimeActor, maximum: number): string[] {
    const harmful = actor.statuses
      .filter((status) => status.harmful ?? HARMFUL_STATUS_KEYS.has(status.key))
      .sort(
        (left, right) =>
          Number(Boolean(right.hardControl)) - Number(Boolean(left.hardControl)) ||
          right.turnsRemaining - left.turnsRemaining ||
          left.id.localeCompare(right.id),
      )
      .slice(0, Math.max(0, maximum));
    const ids = new Set(harmful.map((status) => status.id));
    actor.statuses = actor.statuses.filter((status) => !ids.has(status.id));
    return harmful.map((status) => status.key);
  }

  private decisionTime(runtime: CombatRuntime, now: number): number {
    return Math.max(0, now - (runtime.turnStartedAt ?? now));
  }

  private commandFingerprint(actorId: string, command: CombatActionCommand): string {
    const { requestId: _requestId, operationId: _operationId, ...payload } = command;
    return JSON.stringify({ actorId, ...payload }, Object.keys({ actorId, ...payload }).sort());
  }

  private storeReceipt(
    runtime: CombatRuntime,
    operationId: string,
    fingerprint: string,
    snapshot: CombatSnapshot,
  ): void {
    runtime.operationReceipts.set(operationId, { fingerprint, snapshot });
    while (runtime.operationReceipts.size > COMBAT_OPERATION_HISTORY_LIMIT) {
      const oldest = runtime.operationReceipts.keys().next().value as string | undefined;
      if (!oldest) break;
      runtime.operationReceipts.delete(oldest);
    }
  }
}
