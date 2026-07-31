import { describe, expect, it } from 'vitest';
import type { CombatRuntimeActor } from '../src/modules/combat/combat.types.js';
import { MobAiPlannerService } from '../src/modules/mobs/mob-ai-planner.service.js';
import type { MobAiProfile } from '../src/modules/mobs/mob-ai.types.js';
import type { SkillCatalogDefinition } from '../src/modules/skills/skill.types.js';

const skill = (key: string, energyCost: number): SkillCatalogDefinition => ({
  key,
  name: key,
  description: '',
  characterClass: 'MAGE',
  minimumLevel: 1,
  energyCost,
  cooldownTurns: 2,
  targeting: 'ENEMY',
  maxRank: 1,
  displayOrder: 0,
  treeRow: 0,
  treeColumn: 0,
  icon: '*',
  prerequisiteKeys: [],
  effects: [],
  animationKey: key,
  visual: {
    castEffectKey: `${key}:cast`,
    impactEffectKey: `${key}:impact`,
    accentColor: '#fff',
  },
});

const actor = (
  actorId: string,
  overrides: Partial<CombatRuntimeActor> = {},
): CombatRuntimeActor => ({
  actorId,
  teamId: actorId.startsWith('mob') ? 'mobs' : 'players',
  kind: actorId.startsWith('mob') ? 'MOB' : 'PLAYER',
  name: actorId,
  characterClass: 'MAGE',
  level: 1,
  outfitKey: 'test',
  hp: 100,
  maxHp: 100,
  energy: 100,
  maxEnergy: 100,
  strength: 10,
  agility: 10,
  intelligence: 10,
  armor: 10,
  withdrawn: false,
  statuses: [],
  skills: new Map(),
  ...overrides,
});

const profile: MobAiProfile = {
  version: 1,
  phases: [
    {
      key: 'normal',
      startsAtHpRatio: 1,
      actions: [
        {
          action: 'SKILL',
          skillKey: 'finisher',
          target: 'LOWEST_HP_RATIO',
          priority: 20,
          weight: 1,
          condition: { targetHpBelow: 0.3 },
          telegraph: {
            key: 'finisher-warning',
            resolveAfterTurns: 1,
            counterKinds: ['INTERRUPT'],
          },
        },
        {
          action: 'SKILL',
          skillKey: 'bolt',
          target: 'LOWEST_ARMOR',
          priority: 10,
          weight: 1,
        },
        {
          action: 'BASIC_ATTACK',
          target: 'LOWEST_HP_RATIO',
          priority: 0,
          weight: 1,
        },
      ],
    },
    {
      key: 'enraged',
      startsAtHpRatio: 0.4,
      actions: [
        {
          action: 'SKILL',
          skillKey: 'finisher',
          target: 'LOWEST_HP_RATIO',
          priority: 100,
          weight: 1,
        },
      ],
    },
  ],
};

describe('MobAiPlannerService', () => {
  const planner = new MobAiPlannerService();

  it('selects the highest-priority legal skill and target', () => {
    const mob = actor('mob:1', {
      skills: new Map([
        ['bolt', { definition: skill('bolt', 10), cooldownTurnsRemaining: 0 }],
        ['finisher', { definition: skill('finisher', 20), cooldownTurnsRemaining: 0 }],
      ]),
    });
    const weak = actor('player:weak', { hp: 20, maxHp: 100, armor: 50 });
    const fragile = actor('player:fragile', { hp: 80, maxHp: 100, armor: 1 });

    const plan = planner.plan(profile, {
      actor: mob,
      allies: [mob],
      enemies: [weak, fragile],
      turnNumber: 2,
    });

    expect(plan.phaseKey).toBe('normal');
    expect(plan.command).toEqual({
      action: 'SKILL',
      skillKey: 'finisher',
      targetActorId: weak.actorId,
    });
    expect(plan.telegraph?.key).toBe('finisher-warning');
  });

  it('ignores skills on cooldown or without enough energy', () => {
    const mob = actor('mob:1', {
      energy: 5,
      skills: new Map([
        ['bolt', { definition: skill('bolt', 10), cooldownTurnsRemaining: 0 }],
        ['finisher', { definition: skill('finisher', 1), cooldownTurnsRemaining: 2 }],
      ]),
    });
    const target = actor('player:1');

    expect(
      planner.plan(profile, { actor: mob, allies: [mob], enemies: [target], turnNumber: 1 }),
    ).toMatchObject({ command: { action: 'BASIC_ATTACK', targetActorId: target.actorId } });
  });

  it('switches to the lowest matching HP phase', () => {
    const mob = actor('mob:1', {
      hp: 30,
      skills: new Map([
        ['finisher', { definition: skill('finisher', 10), cooldownTurnsRemaining: 0 }],
      ]),
    });
    const target = actor('player:1');

    expect(
      planner.plan(profile, { actor: mob, allies: [mob], enemies: [target], turnNumber: 1 }),
    ).toMatchObject({ phaseKey: 'enraged', command: { skillKey: 'finisher' } });
  });

  it('uses injected RNG deterministically for random targets and weighted choices', () => {
    const randomProfile: MobAiProfile = {
      version: 1,
      phases: [
        {
          key: 'normal',
          startsAtHpRatio: 1,
          actions: [
            {
              action: 'BASIC_ATTACK',
              target: 'RANDOM_ENEMY',
              priority: 0,
              weight: 1,
            },
          ],
        },
      ],
    };
    const mob = actor('mob:1');
    const enemies = [actor('player:a'), actor('player:b'), actor('player:c')];

    const first = planner.plan(
      randomProfile,
      { actor: mob, allies: [mob], enemies, turnNumber: 1 },
      () => 0.66,
    );
    const second = planner.plan(
      randomProfile,
      { actor: mob, allies: [mob], enemies, turnNumber: 1 },
      () => 0.66,
    );
    expect(second).toEqual(first);
  });

  it('rejects profiles without a base phase and combats without legal targets', () => {
    expect(() =>
      planner.parseProfile({
        version: 1,
        phases: [
          {
            key: 'late',
            startsAtHpRatio: 0.5,
            actions: [{ action: 'BASIC_ATTACK', target: 'LOWEST_HP_RATIO', priority: 0, weight: 1 }],
          },
        ],
      }),
    ).toThrow(/HP ratio 1/i);

    const mob = actor('mob:1');
    expect(() =>
      planner.plan(profile, { actor: mob, allies: [mob], enemies: [], turnNumber: 1 }),
    ).toThrow('MOB_AI_NO_LEGAL_TARGET');
  });
});
