import { randomUUID } from 'node:crypto';
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
} from '../skills/skill.types.js';
import {
  COMBAT_EVENT_HISTORY_LIMIT,
  COMBAT_TURN_TTL_MS,
  magicalDamageMultiplier,
  physicalDamageMultiplier,
} from './combat.rules.js';
import type {
  CombatActionCommand,
  CombatActorInput,
  CombatRuntime,
  CombatRuntimeActor,
  CombatRuntimeStatus,
} from './combat.types.js';

type RandomSource = () => number;

const BASIC_ATTACK_VISUAL = {
  castEffectKey: 'basic-attack:cast',
  projectileEffectKey: 'vfx:weapon-trail',
  impactEffectKey: 'basic-attack:impact',
  accentColor: '#f5d88a',
  travelMs: 280,
};

export class CombatEngine {
  constructor(private readonly random: RandomSource = Math.random) {}

  createRequest(
    combatId: string,
    zoneType: CombatRuntime['zoneType'],
    mapId: string,
    initiator: CombatActorInput,
    recipient: CombatActorInput,
    now: number,
    expiresAt: number,
  ): CombatRuntime {
    return {
      combatId,
      status: 'REQUESTED',
      zoneType,
      mapId,
      createdAt: now,
      expiresAt,
      turnNumber: 0,
      initiatorActorId: initiator.actorId,
      recipientActorId: recipient.actorId,
      actors: [this.toRuntimeActor(initiator), this.toRuntimeActor(recipient)],
      events: [],
      nextSequence: 1,
    };
  }

  start(runtime: CombatRuntime, now: number): CombatSnapshot {
    if (runtime.status !== 'REQUESTED') return this.snapshot(runtime);
    runtime.status = 'ACTIVE';
    runtime.startedAt = now;
    runtime.expiresAt = undefined;
    runtime.turnNumber = 1;

    const [first, second] = runtime.actors;
    const firstInitiative = first.agility + this.random();
    const secondInitiative = second.agility + this.random();
    runtime.activeActorId = firstInitiative >= secondInitiative ? first.actorId : second.actorId;
    runtime.turnStartedAt = now;
    runtime.turnEndsAt = now + COMBAT_TURN_TTL_MS;
    return this.snapshot(runtime);
  }

  decline(
    runtime: CombatRuntime,
    reason: Extract<CombatFinishReason, 'DECLINED' | 'REQUEST_EXPIRED' | 'CANCELLED'>,
    now: number,
  ): CombatSnapshot {
    runtime.status =
      reason === 'DECLINED' ? 'DECLINED' : reason === 'REQUEST_EXPIRED' ? 'EXPIRED' : 'CANCELLED';
    runtime.finishReason = reason;
    runtime.finishedAt = now;
    runtime.expiresAt = undefined;
    return this.snapshot(runtime);
  }

  act(
    runtime: CombatRuntime,
    actorId: string,
    command: CombatActionCommand,
    now: number,
  ): CombatSnapshot {
    if (runtime.status !== 'ACTIVE') throw new Error('COMBAT_NOT_ACTIVE');
    if (runtime.activeActorId !== actorId) throw new Error('COMBAT_NOT_YOUR_TURN');

    const actor = this.actor(runtime, actorId);
    const target = this.opponent(runtime, actorId);
    const result = this.emptyResult(target.actorId);
    const usedSkill =
      command.action === 'SKILL' ? this.requireSkill(actor, command.skillKey) : undefined;

    if (usedSkill?.cooldownTurnsRemaining) throw new Error('COMBAT_SKILL_COOLDOWN');
    if (usedSkill && actor.energy < usedSkill.definition.energyCost)
      throw new Error('COMBAT_INSUFFICIENT_ENERGY');

    if (usedSkill) {
      actor.energy -= usedSkill.definition.energyCost;
      this.resolveSkill(runtime, actor, target, usedSkill.definition, result);
    } else {
      this.resolveBasicAttack(actor, target, result);
    }

    this.decrementCooldowns(actor);
    if (usedSkill) usedSkill.cooldownTurnsRemaining = usedSkill.definition.cooldownTurns;
    this.decrementStatuses(actor, runtime.turnNumber);

    this.appendEvent(runtime, {
      actorId,
      targetActorId: usedSkill?.definition.targeting === 'SELF' ? actorId : target.actorId,
      action: usedSkill ? 'SKILL' : 'BASIC_ATTACK',
      skillKey: usedSkill?.definition.key,
      label: usedSkill?.definition.name ?? 'Basic attack',
      animationKey: usedSkill?.definition.animationKey ?? 'basic-attack',
      visual: usedSkill?.definition.visual ?? BASIC_ATTACK_VISUAL,
      results: [result],
      occurredAt: now,
    });

    if (target.hp <= 0) return this.finish(runtime, actor.actorId, 'DEFEATED', now);
    return this.advance(runtime, now);
  }

  forfeit(
    runtime: CombatRuntime,
    actorId: string,
    now: number,
    reason: Extract<CombatFinishReason, 'FORFEIT' | 'DISCONNECTED' | 'SERVER_SHUTDOWN'> = 'FORFEIT',
  ): CombatSnapshot {
    if (runtime.status === 'REQUESTED') return this.decline(runtime, 'CANCELLED', now);
    if (runtime.status !== 'ACTIVE') return this.snapshot(runtime);
    return this.finish(runtime, this.opponent(runtime, actorId).actorId, reason, now);
  }

  snapshot(runtime: CombatRuntime): CombatSnapshot {
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
      finishReason: runtime.finishReason,
      initiatorActorId: runtime.initiatorActorId,
      recipientActorId: runtime.recipientActorId,
      participants: runtime.actors.map((actor) => this.participant(actor)) as [
        CombatParticipantPayload,
        CombatParticipantPayload,
      ],
      recentActions: [...runtime.events],
    };
  }

  private advance(runtime: CombatRuntime, now: number): CombatSnapshot {
    let next = this.opponent(runtime, runtime.activeActorId!);
    for (let guard = 0; guard < 4; guard += 1) {
      runtime.turnNumber += 1;
      runtime.activeActorId = next.actorId;
      runtime.turnStartedAt = now;
      runtime.turnEndsAt = now + COMBAT_TURN_TTL_MS;

      const turnResults = this.beginTurn(next);
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

      if (next.hp <= 0) {
        return this.finish(runtime, this.opponent(runtime, next.actorId).actorId, 'DEFEATED', now);
      }

      if (!this.hasStatus(next, 'STUNNED')) return this.snapshot(runtime);

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
      next = this.opponent(runtime, next.actorId);
    }
    return this.snapshot(runtime);
  }

  private beginTurn(actor: CombatRuntimeActor): CombatActionResultPayload | undefined {
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

  private resolveBasicAttack(
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    result: CombatActionResultPayload,
  ): void {
    const primary = this.primaryPower(actor);
    const raw = 5 + actor.level * 1.5 + primary * 1.15;
    this.applyDamage(actor, target, raw, 'PHYSICAL', 0, result);
  }

  private resolveSkill(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    skill: SkillCatalogDefinition,
    result: CombatActionResultPayload,
  ): void {
    const effectTarget = skill.targeting === 'SELF' ? actor : target;
    if (effectTarget.actorId !== result.targetActorId) result.targetActorId = effectTarget.actorId;
    for (const effect of skill.effects) {
      this.applyEffect(runtime, actor, effectTarget, effect, result);
    }
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
        });
        result.shieldDelta += amount;
        result.statusesApplied.push(this.statusPayload(status));
        break;
      }
      case 'APPLY_STATUS': {
        if (effect.chance !== undefined && this.random() > effect.chance) break;
        const status = this.addStatus(runtime, actor, target, effect);
        result.statusesApplied.push(this.statusPayload(status));
        break;
      }
    }
  }

  private applyDamage(
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    rawDamage: number,
    damageType: 'PHYSICAL' | 'ARCANE' | 'FIRE' | 'FROST',
    armorPenetration: number,
    result: CombatActionResultPayload,
  ): void {
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
    const incoming =
      1 -
      this.statusMagnitude(target, 'DAMAGE_REDUCTION') +
      this.statusMagnitude(target, 'DAMAGE_TAKEN_INCREASE') +
      (rooted ? 0.1 : 0);
    const mitigation =
      damageType === 'PHYSICAL'
        ? physicalDamageMultiplier(target.armor, armorPenetration)
        : magicalDamageMultiplier(target.armor);
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
  }

  private addStatus(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    target: CombatRuntimeActor,
    effect: Extract<CombatEffectOperation, { type: 'APPLY_STATUS' }>,
  ): CombatRuntimeStatus {
    const existing = target.statuses.find(
      (status) => status.key === effect.statusKey && status.sourceActorId === actor.actorId,
    );
    if (existing) {
      existing.turnsRemaining = Math.max(existing.turnsRemaining, effect.durationTurns);
      existing.magnitude = Math.max(existing.magnitude ?? 0, effect.magnitude ?? 0);
      existing.sourcePower = this.primaryPower(actor);
      existing.appliedTurn = runtime.turnNumber;
      return existing;
    }
    const status: CombatRuntimeStatus = {
      id: randomUUID(),
      key: effect.statusKey,
      turnsRemaining: effect.durationTurns,
      magnitude: effect.magnitude,
      sourceActorId: actor.actorId,
      sourcePower: this.primaryPower(actor),
      appliedTurn: runtime.turnNumber,
    };
    target.statuses.push(status);
    return status;
  }

  private finish(
    runtime: CombatRuntime,
    winnerActorId: string,
    reason: CombatFinishReason,
    now: number,
  ): CombatSnapshot {
    runtime.status = 'FINISHED';
    runtime.winnerActorId = winnerActorId;
    runtime.finishReason = reason;
    runtime.finishedAt = now;
    runtime.activeActorId = undefined;
    runtime.turnStartedAt = undefined;
    runtime.turnEndsAt = undefined;
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

  private appendEvent(
    runtime: CombatRuntime,
    event: Omit<CombatActionResolutionPayload, 'sequence'>,
  ): void {
    runtime.events.push({ ...event, sequence: runtime.nextSequence++ });
    if (runtime.events.length > COMBAT_EVENT_HISTORY_LIMIT)
      runtime.events.splice(0, runtime.events.length - COMBAT_EVENT_HISTORY_LIMIT);
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
      kind: actor.kind,
      characterId: actor.characterId,
      name: actor.name,
      characterClass: actor.characterClass,
      level: actor.level,
      outfitKey: actor.outfitKey,
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

  private opponent(runtime: CombatRuntime, actorId: string): CombatRuntimeActor {
    const opponent = runtime.actors.find((candidate) => candidate.actorId !== actorId);
    if (!opponent) throw new Error('COMBAT_FORBIDDEN');
    return opponent;
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

  private toRuntimeActor(input: CombatActorInput): CombatRuntimeActor {
    return {
      ...input,
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
}
