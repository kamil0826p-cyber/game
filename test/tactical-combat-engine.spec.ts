import { describe, expect, it } from 'vitest';
import type { SkillCatalogDefinition } from '../src/modules/skills/skill.types.js';
import { CombatEngine } from '../src/modules/combat/combat.engine.js';
import { CombatSimulator } from '../src/modules/combat/combat.simulator.js';
import { TUTORIAL_COMBAT_TIMING } from '../src/modules/combat/combat.rules.js';
import type {
  CombatActorInput,
  CombatRuntime,
  CombatTeamInput,
} from '../src/modules/combat/combat.types.js';

const visual = (key: string) => ({
  castEffectKey: `${key}:cast`,
  impactEffectKey: `${key}:impact`,
  accentColor: '#ffffff',
});

const skill = (
  overrides: Partial<SkillCatalogDefinition> = {},
): SkillCatalogDefinition => ({
  key: 'heavy-strike',
  name: 'Heavy strike',
  description: 'Test skill',
  characterClass: 'WARRIOR',
  minimumLevel: 1,
  energyCost: 5,
  cooldownTurns: 0,
  targeting: 'ENEMY',
  maxRank: 1,
  displayOrder: 1,
  treeRow: 0,
  treeColumn: 0,
  icon: 'test',
  prerequisiteKeys: [],
  effects: [
    {
      type: 'DAMAGE',
      scaling: 'STRENGTH',
      coefficient: 1.4,
      damageType: 'PHYSICAL',
    },
  ],
  animationKey: 'heavy-strike',
  visual: visual('heavy-strike'),
  ...overrides,
});

const actor = (
  actorId: string,
  overrides: Partial<CombatActorInput> = {},
): CombatActorInput => ({
  actorId,
  characterId: actorId,
  kind: 'PLAYER',
  name: actorId,
  characterClass: 'WARRIOR',
  level: 20,
  outfitKey: 'warrior',
  hp: 200,
  maxHp: 200,
  energy: 100,
  maxEnergy: 100,
  strength: 30,
  agility: actorId === 'first' ? 50 : 10,
  intelligence: 10,
  armor: 15,
  skills: [{ definition: skill(), cooldownTurnsRemaining: 0 }],
  ...overrides,
});

const team = (anchorActorId: string, actors: CombatActorInput[]): CombatTeamInput => ({
  anchorActorId,
  actors,
});

const activeCombat = (
  firstTeam = [actor('first')],
  secondTeam = [actor('second')],
  zoneType: CombatRuntime['zoneType'] = 'PVP',
) => {
  const engine = new CombatEngine(() => 0.5);
  const runtime = engine.createRequest(
    '00000000-0000-4000-8000-000000000100',
    zoneType,
    'map-a',
    team(firstTeam[0]!.actorId, firstTeam),
    team(secondTeam[0]!.actorId, secondTeam),
    1_000,
    2_000,
  );
  engine.start(runtime, 1_000);
  return { engine, runtime };
};

const participant = (runtime: CombatRuntime, actorId: string) => {
  const value = runtime.actors.find((candidate) => candidate.actorId === actorId);
  if (!value) throw new Error(`Missing actor ${actorId}`);
  return value;
};

const skipUntil = (
  engine: CombatEngine,
  runtime: CombatRuntime,
  actorId: string,
): void => {
  let guard = 0;
  while (runtime.activeActorId !== actorId && runtime.status === 'ACTIVE') {
    if (!runtime.activeActorId || guard++ > 100) throw new Error('Turn did not arrive');
    engine.act(runtime, runtime.activeActorId, { action: 'SKIP' }, 2_000 + guard);
  }
};

describe('tactical CombatEngine contract v2', () => {
  it.each([1, 3, 5, 10])('supports %i actors per side with exact active places', (size) => {
    const first = Array.from({ length: size }, (_, index) =>
      actor(index === 0 ? 'first' : `first-${index}`, { agility: 50 - index }),
    );
    const second = Array.from({ length: size }, (_, index) =>
      actor(index === 0 ? 'second' : `second-${index}`, { agility: 20 - index }),
    );
    const { engine, runtime } = activeCombat(first, second);
    const snapshot = engine.snapshot(runtime);
    expect(snapshot.participants).toHaveLength(size * 2);
    expect(snapshot.teams?.[0].actorIds).toHaveLength(size);
    expect(snapshot.teams?.[1].actorIds).toHaveLength(size);
    expect(
      snapshot.participants
        .filter((entry) => entry.teamId === snapshot.teams?.[0].teamId)
        .map((entry) => entry.formationSlot),
    ).toEqual(Array.from({ length: size }, (_, index) => index));
  });

  it('rejects overlapping rosters and accepts an explicit tutorial timing policy', () => {
    const shared = actor('shared');
    const engine = new CombatEngine(() => 0.5);
    expect(() =>
      engine.createRequest(
        '00000000-0000-4000-8000-000000000109',
        'PVP',
        'map-a',
        team('shared', [shared]),
        team('shared', [shared]),
        1_000,
        2_000,
      ),
    ).toThrow('COMBAT_ACTION_INVALID');

    const runtime = engine.createRequest(
      '00000000-0000-4000-8000-000000000110',
      'SAFE',
      'tutorial-map',
      team('first', [actor('first')]),
      team('second', [actor('second')]),
      1_000,
      2_000,
      TUTORIAL_COMBAT_TIMING,
    );
    const snapshot = engine.start(runtime, 1_000);
    expect(snapshot.timing).toMatchObject({
      policyKey: 'TUTORIAL',
      decisionMs: 30_000,
      reactionMs: 18_000,
      presentationGraceMs: 1_000,
    });
  });

  it('rejects an eleventh actor on either side', () => {
    const engine = new CombatEngine(() => 0.5);
    const oversized = Array.from({ length: 11 }, (_, index) =>
      actor(index === 0 ? 'first' : `first-${index}`),
    );
    expect(() =>
      engine.createRequest(
        '00000000-0000-4000-8000-000000000101',
        'PVP',
        'map-a',
        team('first', oversized),
        team('second', [actor('second')]),
        1_000,
        2_000,
      ),
    ).toThrow('COMBAT_ACTION_INVALID');
  });

  it('uses a ten-second standard decision policy and reports queue analytics', () => {
    const { engine, runtime } = activeCombat();
    const started = engine.snapshot(runtime);
    expect(started).toMatchObject({
      contractVersion: 2,
      rulesVersion: 2,
      phase: 'DECISION',
      timing: { policyKey: 'STANDARD', decisionMs: 10_000, reactionMs: 12_000 },
      nextActorId: 'second',
    });
    engine.act(runtime, 'first', { action: 'DEFEND' }, 4_000);
    engine.act(runtime, 'second', { action: 'SKIP' }, 6_000);
    const metrics = engine.snapshot(runtime).decisionMetrics;
    expect(metrics).toEqual({ samples: 2, medianMs: 1_250, p95Ms: 3_000 });
  });

  it('blocks a melee back-row target until the front line is eliminated', () => {
    const enemies = Array.from({ length: 6 }, (_, index) =>
      actor(index === 0 ? 'enemy-front' : index === 5 ? 'enemy-back' : `enemy-${index}`, {
        agility: 20 - index,
      }),
    );
    const { engine, runtime } = activeCombat([actor('first')], enemies);
    expect(() =>
      engine.act(
        runtime,
        'first',
        { action: 'BASIC_ATTACK', targetActorId: 'enemy-back' },
        1_500,
      ),
    ).toThrow('COMBAT_ACTION_INVALID');
    for (const enemy of enemies.slice(0, 5)) {
      engine.forfeit(runtime, enemy.actorId, 1_600);
    }
    const legal = engine
      .legalActions(runtime, 'first')
      .find((action) => action.action === 'BASIC_ATTACK');
    expect(legal?.targetActorIds).toContain('enemy-back');
  });

  it('supports ally and row targeting from the shared legal-target generator', () => {
    const rowHeal = skill({
      key: 'front-heal',
      name: 'Front heal',
      characterClass: 'MAGE',
      targeting: 'FRONT_ROW',
      effects: [{ type: 'HEAL', scaling: 'INTELLIGENCE', coefficient: 1 }],
    });
    const allies = Array.from({ length: 6 }, (_, index) =>
      actor(index === 0 ? 'first' : `ally-${index}`, {
        characterClass: 'MAGE',
        intelligence: 30,
        agility: 50 - index,
        hp: 100,
        maxHp: 200,
        skills:
          index === 0
            ? [{ definition: rowHeal, cooldownTurnsRemaining: 0 }]
            : [],
      }),
    );
    const { engine, runtime } = activeCombat(allies, [actor('second')]);
    const legal = engine
      .legalActions(runtime, 'first')
      .find((action) => action.skillKey === 'front-heal');
    expect(legal?.targetActorIds).toEqual([
      'first',
      'ally-1',
      'ally-2',
      'ally-3',
      'ally-4',
    ]);
    const snapshot = engine.act(
      runtime,
      'first',
      { action: 'SKILL', skillKey: 'front-heal' },
      1_500,
    );
    expect(snapshot.participants.find((entry) => entry.actorId === 'ally-4')?.hp).toBeGreaterThan(100);
    expect(snapshot.participants.find((entry) => entry.actorId === 'ally-5')?.hp).toBe(100);
  });

  it('guard reduces the next received hit', () => {
    const guarded = activeCombat();
    guarded.engine.act(guarded.runtime, 'first', { action: 'DEFEND' }, 1_100);
    const guardedBefore = participant(guarded.runtime, 'first').hp;
    guarded.engine.act(
      guarded.runtime,
      'second',
      { action: 'BASIC_ATTACK', targetActorId: 'first' },
      1_200,
    );
    const guardedDamage = guardedBefore - participant(guarded.runtime, 'first').hp;

    const open = activeCombat();
    open.engine.act(open.runtime, 'first', { action: 'SKIP' }, 1_100);
    const openBefore = participant(open.runtime, 'first').hp;
    open.engine.act(
      open.runtime,
      'second',
      { action: 'BASIC_ATTACK', targetActorId: 'first' },
      1_200,
    );
    const openDamage = openBefore - participant(open.runtime, 'first').hp;
    expect(guardedDamage).toBeLessThan(openDamage);
  });

  it('intercept redirects damage from a back actor to a front protector', () => {
    const allies = Array.from({ length: 6 }, (_, index) =>
      actor(index === 0 ? 'first' : index === 5 ? 'back-mage' : `front-${index}`, {
        agility: 50 - index,
      }),
    );
    const enemy = actor('second', { characterClass: 'MAGE', agility: 1 });
    const { engine, runtime } = activeCombat(allies, [enemy]);
    engine.act(
      runtime,
      'first',
      { action: 'INTERCEPT', targetActorId: 'back-mage' },
      1_100,
    );
    skipUntil(engine, runtime, 'second');
    const protectorBefore = participant(runtime, 'first').hp;
    const protectedBefore = participant(runtime, 'back-mage').hp;
    const snapshot = engine.act(
      runtime,
      'second',
      { action: 'BASIC_ATTACK', targetActorId: 'back-mage' },
      1_900,
    );
    expect(participant(runtime, 'back-mage').hp).toBe(protectedBefore);
    expect(participant(runtime, 'first').hp).toBeLessThan(protectorBefore);
    expect(snapshot.recentActions.at(-1)?.results[0]).toMatchObject({
      redirectedFromActorId: 'back-mage',
      interceptedByActorId: 'first',
      targetActorId: 'first',
    });
  });

  it('cleanse removes bounded negative effects', () => {
    const allies = [actor('first'), actor('ally', { agility: 30 })];
    const { engine, runtime } = activeCombat(allies, [actor('second')]);
    participant(runtime, 'ally').statuses.push(
      {
        id: 'burn',
        key: 'BURN',
        turnsRemaining: 2,
        magnitude: 0.2,
        sourceActorId: 'second',
        sourcePower: 20,
        appliedTurn: 0,
      },
      {
        id: 'slow',
        key: 'SLOWED',
        turnsRemaining: 2,
        magnitude: 0.2,
        sourceActorId: 'second',
        sourcePower: 20,
        appliedTurn: 0,
      },
      {
        id: 'bleed',
        key: 'BLEED',
        turnsRemaining: 2,
        magnitude: 0.2,
        sourceActorId: 'second',
        sourcePower: 20,
        appliedTurn: 0,
      },
    );
    const snapshot = engine.act(
      runtime,
      'first',
      { action: 'CLEANSE', targetActorId: 'ally' },
      1_200,
    );
    const cleanseEvent = snapshot.recentActions
      .filter((event) => event.skillKey === 'tactical:cleanse')
      .at(-1);
    expect(cleanseEvent?.results[0].cleansedStatuses).toEqual(['BURN', 'SLOWED']);
    expect(participant(runtime, 'ally').statuses.map((status) => status.key)).toEqual([
      'BLEED',
    ]);
  });

  it('opens an authoritative reaction window and interrupt creates stagger', () => {
    const meteor = skill({
      key: 'mage-meteor',
      name: 'Meteor',
      characterClass: 'MAGE',
      targeting: 'ALL_ENEMIES',
      energyCost: 20,
      effects: [
        {
          type: 'DAMAGE',
          scaling: 'INTELLIGENCE',
          coefficient: 2,
          damageType: 'FIRE',
        },
      ],
    });
    const caster = actor('first', {
      characterClass: 'MAGE',
      intelligence: 40,
      skills: [{ definition: meteor, cooldownTurnsRemaining: 0 }],
    });
    const { engine, runtime } = activeCombat([caster], [actor('second')]);
    const declaration = engine.act(
      runtime,
      'first',
      { action: 'SKILL', skillKey: 'mage-meteor' },
      1_500,
    );
    expect(declaration).toMatchObject({
      phase: 'REACTION',
      telegraph: {
        actorId: 'first',
        skillKey: 'mage-meteor',
        targetActorIds: ['second'],
        reactionActorIds: ['second'],
      },
    });
    expect(declaration.legalActionsByActorId?.second).toContainEqual(
      expect.objectContaining({ action: 'INTERRUPT', reactionOnly: true }),
    );
    const interrupted = engine.act(
      runtime,
      'second',
      {
        action: 'INTERRUPT',
        targetActorId: 'first',
        operationId: 'interrupt-1',
        expectedTurnNumber: 1,
        contractVersion: 2,
      },
      1_600,
    );
    expect(interrupted.phase).toBe('DECISION');
    expect(interrupted.activeActorId).toBe('second');
    expect(
      interrupted.participants
        .find((entry) => entry.actorId === 'first')
        ?.statuses.some((status) => status.key === 'STAGGER'),
    ).toBe(true);
  });

  it('applies diminishing returns to repeated hard control in PvP', () => {
    const stun = skill({
      key: 'test-stun',
      name: 'Test stun',
      targeting: 'ENEMY',
      cooldownTurns: 0,
      effects: [
        {
          type: 'APPLY_STATUS',
          statusKey: 'STUNNED',
          durationTurns: 4,
          hardControl: true,
        },
      ],
    });
    const caster = actor('first', {
      skills: [{ definition: stun, cooldownTurnsRemaining: 0 }],
    });
    const { engine, runtime } = activeCombat([caster], [actor('second')]);
    for (let index = 0; index < 4; index += 1) {
      engine.act(
        runtime,
        'first',
        { action: 'SKILL', skillKey: 'test-stun', targetActorId: 'second' },
        1_100 + index * 100,
      );
      if (runtime.status !== 'ACTIVE') break;
      skipUntil(engine, runtime, 'first');
    }
    expect(participant(runtime, 'second').controlDrStacks).toBe(3);
    const finalStun = engine
      .snapshot(runtime)
      .recentActions.filter((event) => event.skillKey === 'test-stun')
      .at(-1);
    expect(finalStun?.results[0].rejectedStatusReason).toBe('DIMINISHING_RETURNS');
  });

  it('uses defensive timeout by default instead of granting a free attack', () => {
    const { engine, runtime } = activeCombat();
    const enemyBefore = participant(runtime, 'second').hp;
    const snapshot = engine.timeout(runtime, 'first', 11_000);
    expect(participant(runtime, 'second').hp).toBe(enemyBefore);
    expect(snapshot.recentActions.at(-1)?.skillKey).toBe('tactical:defend');
    expect(
      snapshot.participants
        .find((entry) => entry.actorId === 'first')
        ?.statuses.some((status) => status.key === 'GUARD'),
    ).toBe(true);
  });

  it('applies the server fallback for a disconnected active actor', () => {
    const { engine, runtime } = activeCombat();
    engine.disconnect(runtime, 'first', 1_200);
    const snapshot = engine.timeout(runtime, 'first', 3_200);
    expect(snapshot.recentActions.at(-1)?.skillKey).toBe('tactical:defend');
    expect(snapshot.activeActorId).toBe('second');
    expect(
      snapshot.participants.find((entry) => entry.actorId === 'first')?.disconnected,
    ).toBe(true);
  });

  it('does not count rejected commands as decisions or consume failed reactions', () => {
    const enemies = Array.from({ length: 6 }, (_, index) =>
      actor(index === 5 ? 'enemy-back' : `enemy-front-${index}`),
    );
    const rejected = activeCombat([actor('first')], enemies);
    expect(() =>
      rejected.engine.act(
        rejected.runtime,
        'first',
        { action: 'BASIC_ATTACK', targetActorId: 'enemy-back' },
        1_500,
      ),
    ).toThrow('COMBAT_ACTION_INVALID');
    expect(rejected.engine.snapshot(rejected.runtime).decisionMetrics?.samples).toBe(0);

    const meteor = skill({
      key: 'mage-meteor',
      name: 'Meteor',
      characterClass: 'MAGE',
      targeting: 'ALL_ENEMIES',
      energyCost: 20,
    });
    const reaction = activeCombat(
      [
        actor('first', {
          characterClass: 'MAGE',
          intelligence: 30,
          skills: [{ definition: meteor, cooldownTurnsRemaining: 0 }],
        }),
      ],
      [actor('second', { energy: 100 })],
    );
    reaction.engine.act(
      reaction.runtime,
      'first',
      { action: 'SKILL', skillKey: 'mage-meteor' },
      1_500,
    );
    expect(() =>
      reaction.engine.act(
        reaction.runtime,
        'second',
        { action: 'INTERRUPT', targetActorId: 'wrong-target' },
        1_600,
      ),
    ).toThrow('COMBAT_ACTION_INVALID');
    expect(reaction.engine.snapshot(reaction.runtime).telegraph?.reactedActorIds).toEqual([]);
  });

  it('does not resolve the same operation twice and rejects conflicting reuse', () => {
    const { engine, runtime } = activeCombat(
      [actor('first', { strength: 100 })],
      [actor('second', { hp: 1, maxHp: 1 })],
    );
    const command = {
      action: 'BASIC_ATTACK' as const,
      targetActorId: 'second',
      operationId: 'finish-operation',
      expectedTurnNumber: 1,
      contractVersion: 2 as const,
    };
    const resolved = engine.act(runtime, 'first', command, 1_100);
    expect(resolved.status).toBe('FINISHED');
    const duplicate = engine.act(runtime, 'first', command, 1_200);
    expect(duplicate.eventSequence).toBe(resolved.eventSequence);
    expect(duplicate.participants.find((entry) => entry.actorId === 'second')?.hp).toBe(0);
    expect(() =>
      engine.act(runtime, 'first', { ...command, action: 'DEFEND' }, 1_300),
    ).toThrow('COMBAT_OPERATION_CONFLICT');
  });

  it('rejects a stale turn before mutating state', () => {
    const { engine, runtime } = activeCombat();
    expect(() =>
      engine.act(
        runtime,
        'first',
        { action: 'DEFEND', operationId: 'stale', expectedTurnNumber: 99 },
        1_100,
      ),
    ).toThrow('COMBAT_STALE_TURN');
    expect(runtime.events).toHaveLength(0);
  });

  it('reconnect preserves queue, telegraph and event sequence', () => {
    const meteor = skill({
      key: 'mage-meteor',
      name: 'Meteor',
      characterClass: 'MAGE',
      targeting: 'ALL_ENEMIES',
    });
    const { engine, runtime } = activeCombat(
      [
        actor('first', {
          characterClass: 'MAGE',
          skills: [{ definition: meteor, cooldownTurnsRemaining: 0 }],
        }),
      ],
      [actor('second')],
    );
    const before = engine.act(
      runtime,
      'first',
      { action: 'SKILL', skillKey: 'mage-meteor' },
      1_200,
    );
    engine.disconnect(runtime, 'second', 1_300);
    const reconnected = engine.reconnect(runtime, 'second', 1_400);
    expect(reconnected.turnQueue).toEqual(before.turnQueue);
    expect(reconnected.telegraph).toEqual(before.telegraph);
    expect(reconnected.eventSequence).toBe(before.eventSequence);
    expect(reconnected.participants.find((entry) => entry.actorId === 'second')?.disconnected).toBe(
      false,
    );
  });

  it('runs the same rules in the infrastructure-free seeded simulator', () => {
    const simulator = new CombatSimulator(
      {
        combatId: '00000000-0000-4000-8000-000000000102',
        zoneType: 'PVP',
        mapId: 'map-a',
        firstTeam: team('first', [actor('first')]),
        secondTeam: team('second', [actor('second')]),
        startedAt: 1_000,
      },
      42,
    );
    const first = simulator.snapshot();
    const result = simulator.dispatch({
      actorId: first.activeActorId!,
      command: { action: 'DEFEND', operationId: 'sim-1' },
    });
    expect(result.contractVersion).toBe(2);
    expect(result.eventSequence).toBe(1);
  });
});
