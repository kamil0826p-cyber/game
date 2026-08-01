import { describe, expect, it } from 'vitest';
import { CombatEngine } from '../src/modules/combat/combat.engine.js';
import type {
  CombatActorInput,
  CombatRuntime,
  CombatTeamInput,
} from '../src/modules/combat/combat.types.js';
import type { SkillCatalogDefinition } from '../src/modules/skills/skill.types.js';

const burnSkill: SkillCatalogDefinition = {
  key: 'test-burn',
  name: 'Test burn',
  description: 'Applies a harmful status.',
  characterClass: 'MAGE',
  minimumLevel: 1,
  energyCost: 0,
  cooldownTurns: 0,
  targeting: 'ENEMY',
  maxRank: 1,
  displayOrder: 0,
  treeRow: 0,
  treeColumn: 0,
  icon: 'B',
  prerequisiteKeys: [],
  effects: [
    {
      type: 'APPLY_STATUS',
      statusKey: 'BURN',
      durationTurns: 3,
      magnitude: 0.1,
      harmful: true,
    },
  ],
  animationKey: 'test-burn',
  visual: {
    castEffectKey: 'test-burn:cast',
    impactEffectKey: 'test-burn:impact',
    accentColor: '#ffffff',
  },
};

const stunSkill: SkillCatalogDefinition = {
  ...burnSkill,
  key: 'test-stun',
  name: 'Test stun',
  effects: [
    {
      type: 'APPLY_STATUS',
      statusKey: 'STUNNED',
      durationTurns: 4,
      harmful: true,
      hardControl: true,
    },
  ],
};

const telegraphSkill: SkillCatalogDefinition = {
  ...burnSkill,
  key: 'test-telegraph',
  name: 'Ruinous cast',
  effects: [
    {
      type: 'DAMAGE',
      scaling: 'INTELLIGENCE',
      coefficient: 2,
      damageType: 'ARCANE',
    },
  ],
  telegraph: {
    reactionWindowMs: 4_000,
    publicIntent: 'Heavy arcane damage to the selected front target.',
    interruptible: true,
    counters: ['INTERRUPT', 'GUARD', 'INTERCEPT'],
  },
};

function actor(
  actorId: string,
  overrides: Partial<CombatActorInput> = {},
): CombatActorInput {
  return {
    actorId,
    characterId: actorId,
    kind: 'PLAYER',
    name: actorId,
    characterClass: 'MAGE',
    level: 30,
    outfitKey: 'test',
    hp: 400,
    maxHp: 400,
    energy: 200,
    maxEnergy: 200,
    strength: 20,
    agility: 20,
    intelligence: 50,
    armor: 10,
    skills: [],
    ...overrides,
  };
}

function team(anchorActorId: string, actors: CombatActorInput[]): CombatTeamInput {
  return { anchorActorId, actors };
}

function create(
  first: CombatActorInput[],
  second: CombatActorInput[],
  zoneType: 'SAFE' | 'OUTLAW' | 'PVP' = 'PVP',
): { engine: CombatEngine; runtime: CombatRuntime } {
  const engine = new CombatEngine(() => 0.5);
  const runtime = engine.createRequest(
    '00000000-0000-4000-8000-000000000111',
    zoneType,
    'map-a',
    team(first[0]!.actorId, first),
    team(second[0]!.actorId, second),
    1_000,
    20_000,
  );
  engine.start(runtime, 1_000);
  return { engine, runtime };
}

function learned(definition: SkillCatalogDefinition) {
  return [{ definition, cooldownTurnsRemaining: 0 }];
}

describe('tactical CombatEngine', () => {
  it.each([1, 3, 5, 10])('supports %i active formation slots per side', (size) => {
    const first = Array.from({ length: size }, (_, index) =>
      actor(`a-${index}`, { agility: 100 - index }),
    );
    const second = Array.from({ length: size }, (_, index) =>
      actor(`b-${index}`, { agility: 50 - index }),
    );
    const { engine, runtime } = create(first, second);
    const snapshot = engine.snapshot(runtime);
    expect(snapshot.participants).toHaveLength(size * 2);
    for (const teamId of snapshot.teams?.map((entry) => entry.teamId) ?? []) {
      const slots = snapshot.participants
        .filter((participant) => participant.teamId === teamId)
        .map((participant) => participant.formationSlot);
      expect(new Set(slots).size).toBe(size);
      expect(slots.every((slot) => slot !== undefined && slot >= 0 && slot < 10)).toBe(true);
    }
  });

  it('keeps a living front row between ordinary attacks and the back row', () => {
    const { engine, runtime } = create(
      [actor('attacker', { agility: 50 })],
      [
        actor('front', { formationSlot: 0, agility: 10 }),
        actor('back', { formationSlot: 5, agility: 5 }),
      ],
    );
    expect(engine.legalTargetIds(runtime, 'attacker', 'BASIC_ATTACK')).toEqual(['front']);
    expect(() =>
      engine.act(
        runtime,
        'attacker',
        { action: 'BASIC_ATTACK', targetActorId: 'back' },
        2_000,
      ),
    ).toThrow('COMBAT_TARGET_ILLEGAL');
  });

  it('generates ally and row targets from the same authoritative function', () => {
    const { engine, runtime } = create(
      [
        actor('caster', { formationSlot: 0, agility: 50 }),
        actor('ally', { formationSlot: 5, agility: 20 }),
      ],
      [
        actor('enemy-front', { formationSlot: 0, agility: 10 }),
        actor('enemy-back', { formationSlot: 5, agility: 5 }),
      ],
    );
    expect(engine.legalTargetIds(runtime, 'caster', 'ALLY')).toEqual(['caster', 'ally']);
    expect(engine.legalTargetIds(runtime, 'caster', 'FRONT_ROW')).toEqual(['enemy-front']);
    expect(engine.legalTargetIds(runtime, 'caster', 'BACK_ROW')).toEqual([]);
  });

  it('guard is a defensive decision and the default player timeout fallback', () => {
    const guarded = create(
      [actor('defender', { agility: 60 }), actor('attacker', { agility: 50 })],
      [actor('enemy', { agility: 1 })],
    );
    guarded.engine.act(guarded.runtime, 'defender', { action: 'GUARD' }, 2_000);
    const before = guarded.runtime.actors.find((entry) => entry.actorId === 'enemy')!.hp;
    const defended = guarded.engine.act(
      guarded.runtime,
      'attacker',
      { action: 'BASIC_ATTACK', targetActorId: 'enemy' },
      3_000,
    );
    expect(defended.participants.find((entry) => entry.actorId === 'enemy')!.hp).toBeLessThan(before);

    const timeout = create(
      [actor('slow-player', { agility: 60 })],
      [actor('target', { agility: 1 })],
    );
    const targetBefore = timeout.runtime.actors.find((entry) => entry.actorId === 'target')!.hp;
    const timedOut = timeout.engine.act(
      timeout.runtime,
      'slow-player',
      { action: 'BASIC_ATTACK' },
      12_000,
    );
    expect(timedOut.participants.find((entry) => entry.actorId === 'target')!.hp).toBe(targetBefore);
    expect(timedOut.recentActions.at(-1)).toMatchObject({
      tacticalAction: 'GUARD',
      timedOut: true,
    });
  });

  it('intercept redirects a protected ally hit to the protector', () => {
    const { engine, runtime } = create(
      [
        actor('protector', { formationSlot: 0, agility: 60 }),
        actor('protected', { formationSlot: 1, agility: 10 }),
      ],
      [actor('attacker', { agility: 50 })],
    );
    engine.act(
      runtime,
      'protector',
      { action: 'INTERCEPT', targetActorId: 'protected' },
      2_000,
    );
    const snapshot = engine.act(
      runtime,
      'attacker',
      { action: 'BASIC_ATTACK', targetActorId: 'protected' },
      3_000,
    );
    expect(snapshot.participants.find((entry) => entry.actorId === 'protected')!.hp).toBe(400);
    expect(snapshot.participants.find((entry) => entry.actorId === 'protector')!.hp).toBeLessThan(400);
    expect(snapshot.recentActions.at(-1)?.results[0]).toMatchObject({
      targetActorId: 'protector',
      redirectedFromActorId: 'protected',
      reactionChangedOutcome: true,
    });
  });

  it('declares a reconnect-safe telegraph and resolves a legal interrupt reaction', () => {
    const { engine, runtime } = create(
      [actor('caster', { agility: 60, skills: learned(telegraphSkill) })],
      [actor('reactor', { agility: 10 })],
    );
    const declared = engine.act(
      runtime,
      'caster',
      {
        requestId: 'telegraph-declare',
        expectedTurn: 1,
        action: 'SKILL',
        skillKey: telegraphSkill.key,
        targetActorId: 'reactor',
      },
      2_000,
    );
    expect(declared).toMatchObject({
      phase: 'REACTION',
      lastSequence: 1,
      telegraph: {
        actorId: 'caster',
        targetActorIds: ['reactor'],
        interruptible: true,
      },
    });
    const reconnected = engine.snapshot(runtime);
    expect(reconnected.telegraph).toEqual(declared.telegraph);
    expect(reconnected.turnOrder).toEqual(declared.turnOrder);
    expect(reconnected.lastSequence).toBe(declared.lastSequence);

    const interrupted = engine.act(
      runtime,
      'reactor',
      {
        requestId: 'interrupt-operation',
        expectedTurn: 1,
        action: 'INTERRUPT',
        telegraphId: declared.telegraph!.id,
      },
      3_000,
    );
    expect(interrupted.telegraph).toBeUndefined();
    expect(interrupted.participants.find((entry) => entry.actorId === 'caster')?.statuses).toContainEqual(
      expect.objectContaining({ key: 'STAGGER' }),
    );
    expect(interrupted.recentActions.at(-1)).toMatchObject({
      tacticalAction: 'INTERRUPT',
      reactionToTelegraphId: declared.telegraph!.id,
    });
  });

  it('cleanse removes harmful statuses without removing beneficial effects', () => {
    const { engine, runtime } = create(
      [actor('caster', { agility: 60, skills: learned(burnSkill) })],
      [actor('target', { agility: 10 })],
    );
    engine.act(
      runtime,
      'caster',
      { action: 'SKILL', skillKey: burnSkill.key, targetActorId: 'target' },
      2_000,
    );
    expect(runtime.actors.find((entry) => entry.actorId === 'target')?.statuses).toContainEqual(
      expect.objectContaining({ key: 'BURN' }),
    );
    const cleansed = engine.act(
      runtime,
      'target',
      { action: 'CLEANSE', targetActorId: 'target' },
      3_000,
    );
    expect(cleansed.participants.find((entry) => entry.actorId === 'target')?.statuses).not.toContainEqual(
      expect.objectContaining({ key: 'BURN' }),
    );
    expect(cleansed.recentActions.at(-1)?.results[0]?.statusesCleansed).toEqual(['BURN']);
  });

  it('applies diminishing returns to repeated hard control in PVP', () => {
    const { engine, runtime } = create(
      [actor('controller', { agility: 60, skills: learned(stunSkill) })],
      [actor('target', { agility: 10 })],
      'PVP',
    );
    const durations: Array<number | undefined> = [];
    let resisted: string | undefined;
    for (let index = 0; index < 4; index += 1) {
      const control = engine.act(
        runtime,
        'controller',
        { action: 'SKILL', skillKey: stunSkill.key, targetActorId: 'target' },
        2_000 + index * 2_000,
      );
      const status = control.participants
        .find((entry) => entry.actorId === 'target')
        ?.statuses.find((entry) => entry.key === 'STUNNED');
      durations.push(status?.turnsRemaining);
      resisted = control.recentActions.at(-1)?.results[0]?.statusResisted;
      if (runtime.status === 'ACTIVE' && runtime.activeActorId === 'target') {
        engine.act(runtime, 'target', { action: 'SKIP' }, 3_000 + index * 2_000);
      }
    }
    expect(durations[0]).toBe(4);
    expect(durations[1]).toBeLessThanOrEqual(2);
    expect(durations[2]).toBeLessThanOrEqual(1);
    expect(resisted).toBe('STUNNED');
  });

  it('replays the same operation once and rejects stale or colliding commands', () => {
    const { engine, runtime } = create(
      [actor('first', { agility: 60 })],
      [actor('second', { agility: 10 })],
    );
    const command = {
      requestId: 'combat-operation-1',
      expectedTurn: 1,
      action: 'BASIC_ATTACK' as const,
      targetActorId: 'second',
    };
    const first = engine.act(runtime, 'first', command, 2_000);
    const replay = engine.act(runtime, 'first', command, 2_100);
    expect(replay.lastSequence).toBe(first.lastSequence);
    expect(replay.participants).toEqual(first.participants);
    expect(() =>
      engine.act(
        runtime,
        'first',
        { ...command, action: 'GUARD' },
        2_200,
      ),
    ).toThrow('COMBAT_OPERATION_ID_COLLISION');
    expect(() =>
      engine.act(
        runtime,
        'second',
        {
          requestId: 'stale-turn',
          expectedTurn: 1,
          action: 'GUARD',
        },
        3_000,
      ),
    ).toThrow('COMBAT_STALE_TURN');
  });

  it('supports uneven full-size battles without special-case engine paths', () => {
    const { engine, runtime } = create(
      [actor('solo', { agility: 100 })],
      Array.from({ length: 10 }, (_, index) => actor(`enemy-${index}`, { agility: 50 - index })),
    );
    const snapshot = engine.snapshot(runtime);
    expect(snapshot.participants.filter((entry) => entry.teamId === snapshot.teams?.[0].teamId)).toHaveLength(1);
    expect(snapshot.participants.filter((entry) => entry.teamId === snapshot.teams?.[1].teamId)).toHaveLength(10);
    expect(snapshot.legalActions?.[0]?.actions.find((entry) => entry.action === 'BASIC_ATTACK')?.targetActorIds.length).toBeGreaterThan(0);
  });
});
