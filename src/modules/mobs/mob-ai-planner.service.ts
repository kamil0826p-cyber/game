import { Injectable } from '@nestjs/common';
import type { CombatRuntimeActor } from '../combat/combat.types.js';
import { mobAiProfileSchema } from './mob-ai.schema.js';
import type {
  MobAiActionDefinition,
  MobAiContext,
  MobAiProfile,
  MobAiTargetPolicy,
  PlannedMobAction,
} from './mob-ai.types.js';

@Injectable()
export class MobAiPlannerService {
  parseProfile(input: unknown): MobAiProfile {
    return mobAiProfileSchema.parse(input) as MobAiProfile;
  }

  plan(
    profile: MobAiProfile,
    context: MobAiContext,
    random: () => number = Math.random,
  ): PlannedMobAction {
    const livingEnemies = context.enemies.filter((actor) => !actor.withdrawn && actor.hp > 0);
    if (livingEnemies.length === 0) {
      throw new Error('MOB_AI_NO_LEGAL_TARGET');
    }

    const hpRatio = context.actor.hp / Math.max(1, context.actor.maxHp);
    const phase = [...profile.phases]
      .filter((candidate) => hpRatio <= candidate.startsAtHpRatio)
      .sort((left, right) => left.startsAtHpRatio - right.startsAtHpRatio || left.key.localeCompare(right.key))[0];
    if (!phase) throw new Error('MOB_AI_NO_ACTIVE_PHASE');

    const legal = phase.actions.filter((action) => this.isLegal(action, context, livingEnemies));
    if (legal.length === 0) {
      return {
        phaseKey: phase.key,
        command: { action: 'BASIC_ATTACK', targetActorId: this.selectTarget('LOWEST_HP_RATIO', livingEnemies, context.actor, random).actorId },
      };
    }

    const highestPriority = Math.max(...legal.map((action) => action.priority));
    const candidates = legal.filter((action) => action.priority === highestPriority);
    const selected = this.weightedChoice(candidates, random);
    const target = this.selectTarget(selected.target, livingEnemies, context.actor, random);
    return {
      phaseKey: phase.key,
      command: {
        action: selected.action,
        ...(selected.skillKey ? { skillKey: selected.skillKey } : {}),
        targetActorId: target.actorId,
      },
      ...(selected.telegraph ? { telegraph: selected.telegraph } : {}),
    };
  }

  private isLegal(
    action: MobAiActionDefinition,
    context: MobAiContext,
    enemies: readonly CombatRuntimeActor[],
  ): boolean {
    if (action.target === 'SELF' && action.action === 'BASIC_ATTACK') return false;
    if (action.action === 'SKILL') {
      const skill = action.skillKey ? context.actor.skills.get(action.skillKey) : undefined;
      if (!skill || skill.cooldownTurnsRemaining > 0 || context.actor.energy < skill.definition.energyCost) {
        return false;
      }
      if (skill.definition.targeting === 'SELF' && action.target !== 'SELF') return false;
      if (skill.definition.targeting !== 'SELF' && action.target === 'SELF') return false;
    }

    const condition = action.condition;
    if (!condition) return true;
    const actorHpRatio = context.actor.hp / Math.max(1, context.actor.maxHp);
    if (condition.actorHpBelow !== undefined && actorHpRatio >= condition.actorHpBelow) return false;
    if (condition.actorHpAbove !== undefined && actorHpRatio <= condition.actorHpAbove) return false;
    if (condition.turnAtLeast !== undefined && context.turnNumber < condition.turnAtLeast) return false;
    if (
      condition.requiredStatus &&
      !context.actor.statuses.some((status) => status.key === condition.requiredStatus)
    ) {
      return false;
    }
    if (
      condition.forbiddenStatus &&
      context.actor.statuses.some((status) => status.key === condition.forbiddenStatus)
    ) {
      return false;
    }
    if (
      condition.targetHpBelow !== undefined &&
      !enemies.some((enemy) => enemy.hp / Math.max(1, enemy.maxHp) < condition.targetHpBelow!)
    ) {
      return false;
    }
    return true;
  }

  private selectTarget(
    policy: MobAiTargetPolicy,
    enemies: readonly CombatRuntimeActor[],
    actor: CombatRuntimeActor,
    random: () => number,
  ): CombatRuntimeActor {
    if (policy === 'SELF') return actor;
    const ordered = [...enemies].sort((left, right) => left.actorId.localeCompare(right.actorId));
    switch (policy) {
      case 'LOWEST_HP_RATIO':
        return ordered.sort(
          (left, right) =>
            left.hp / Math.max(1, left.maxHp) - right.hp / Math.max(1, right.maxHp) ||
            left.actorId.localeCompare(right.actorId),
        )[0]!;
      case 'HIGHEST_HP_RATIO':
        return ordered.sort(
          (left, right) =>
            right.hp / Math.max(1, right.maxHp) - left.hp / Math.max(1, left.maxHp) ||
            left.actorId.localeCompare(right.actorId),
        )[0]!;
      case 'LOWEST_ARMOR':
        return ordered.sort((left, right) => left.armor - right.armor || left.actorId.localeCompare(right.actorId))[0]!;
      case 'RANDOM_ENEMY': {
        const index = Math.min(ordered.length - 1, Math.floor(this.normalizedRandom(random) * ordered.length));
        return ordered[index]!;
      }
    }
  }

  private weightedChoice(
    actions: readonly MobAiActionDefinition[],
    random: () => number,
  ): MobAiActionDefinition {
    const total = actions.reduce((sum, action) => sum + action.weight, 0);
    let cursor = this.normalizedRandom(random) * total;
    for (const action of actions) {
      cursor -= action.weight;
      if (cursor < 0) return action;
    }
    return actions[actions.length - 1]!;
  }

  private normalizedRandom(random: () => number): number {
    const value = random();
    if (!Number.isFinite(value)) return 0;
    return Math.min(0.999999999, Math.max(0, value));
  }
}
