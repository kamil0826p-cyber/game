import { describe, expect, it } from 'vitest';
import { CombatEngine } from '../src/modules/combat/combat.engine.js';
import type {
  CombatActorInput,
  CombatRuntime,
} from '../src/modules/combat/combat.types.js';
import { buildClaimedEncounter } from '../src/modules/mobs/encounters/encounter.actor-factory.js';
import { planEncounterAction } from '../src/modules/mobs/encounters/encounter.ai.js';
import { ENCOUNTER_CATALOG } from '../src/modules/mobs/encounters/encounter.catalog.js';
import {
  createEncounterExecution,
  evaluateEncounterEligibility,
  recordEncounterTimeout,
  synchronizeEncounter,
} from '../src/modules/mobs/encounters/encounter.runtime.js';
import {
  dryRunEncounter,
  scaleEncounter,
} from '../src/modules/mobs/encounters/encounter.scaling.js';
import type {
  EncounterDefinition,
  EncounterExecution,
} from '../src/modules/mobs/encounters/encounter.types.js';
import {
  assertEncounterCatalog,
  validateEncounterDefinition,
} from '../src/modules/mobs/encounters/encounter.validator.js';
import type { RuntimeMob } from '../src/modules/mobs/mob.types.js';

const player = (actorId: string): CombatActorInput => ({
  actorId,
  characterId: actorId,
  kind: 'PLAYER',
  name: actorId,
  characterClass: 'MAGE',
  level: 20,
  outfitKey: 'mage-apprentice',
  hp: 260,
  maxHp: 260,
  energy: 160,
  maxEnergy: 160,
  strength: 12,
  agility: 18,
  intelligence: 40,
  armor: 18,
  skills: [],
});

const mob: RuntimeMob = {
  id: '00000000-0000-4000-8000-000000000207',
  definitionKey: 'test-executioner',
  name: 'Testowy Kat',
  rank: 'EXECUTIONER',
  mapId: 'map-a',
  x: 5,
  y: 5,
  level: 12,
  characterClass: 'WARRIOR',
  outfitKey: 'mob-scorpion-executioner',
  renderScale: 1,
  respawnMs: 30_000,
  experience: 100,
  stats: {
    maxHp: 240,
    maxEnergy: 100,
    strength: 28,
    agility: 18,
    intelligence: 22,
    armor: 20,
  },
  loot: [],
  state: 'ALIVE',
};

function executionRuntime(partySize = 5): {
  engine: CombatEngine;
  runtime: CombatRuntime;
  claimed: ReturnType<typeof buildClaimedEncounter>;
} {
  const definition = ENCOUNTER_CATALOG.find((entry) => entry.key === 'execution-circle')!;
  const claimed = buildClaimedEncounter(mob, scaleEncounter(definition, partySize));
  const engine = new CombatEngine(() => 0.5);
  const runtime = engine.createRequest(
    '00000000-0000-4000-8000-000000000999',
    'SAFE',
    'map-a',
    {
      anchorActorId: 'player-1',
      actors: Array.from({ length: partySize }, (_, index) => player(`player-${index + 1}`)),
    },
    {
      anchorActorId: claimed.rootActorId,
      actors: claimed.initialActors,
    },
    1_000,
    1_000,
  );
  engine.start(runtime, 1_000);
  return { engine, runtime, claimed };
}

function bloodRiteRuntime(): {
  engine: CombatEngine;
  runtime: CombatRuntime;
  execution: EncounterExecution;
  scribeActorId: string;
} {
  const { engine, runtime, claimed } = executionRuntime(5);
  const execution = createEncounterExecution(runtime, mob.id, claimed, 12345);
  const scribe = runtime.actors.find((actor) =>
    actor.actorId.endsWith(':blood-scribe'),
  );
  if (!scribe) throw new Error('Test encounter is missing the blood scribe.');
  runtime.phase = 'DECISION';
  runtime.activeActorId = scribe.actorId;
  execution.state.phaseIndex = 1;
  execution.state.phaseKey = 'blood_rite';
  return { engine, runtime, execution, scribeActorId: scribe.actorId };
}

const cloneEncounter = (definition: EncounterDefinition): EncounterDefinition =>
  JSON.parse(JSON.stringify(definition)) as EncounterDefinition;

describe('PvE encounter framework', () => {
  it('validates every built-in versioned encounter', () => {
    expect(() => assertEncounterCatalog(ENCOUNTER_CATALOG)).not.toThrow();
    for (const definition of ENCOUNTER_CATALOG) {
      expect(validateEncounterDefinition(definition).errors).toEqual([]);
      expect(definition.phases).toHaveLength(3);
    }
  });

  it('changes encounter mechanics and roster at 1, 3, 5 and 10 players', () => {
    const definition = ENCOUNTER_CATALOG.find((entry) => entry.key === 'execution-circle')!;
    const report = dryRunEncounter(definition);
    expect(report.map((row) => row.partySize)).toEqual([1, 3, 5, 10]);
    expect(report.map((row) => row.actorCount)).toEqual([1, 2, 3, 7]);
    expect(report[3]).toMatchObject({ summonCapacity: 3, targetTurns: 14 });
    expect(report[3]!.actorCount + report[3]!.summonCapacity).toBe(10);
    expect(new Set(report.map((row) => row.telegraphTargetCount)).size).toBeGreaterThan(1);
    expect(report[2]?.mechanics).toContain('METEOR_TELEGRAPH');
    expect(report[3]?.mechanics).toContain('PARALLEL_SUPPORT');
  });

  it('builds front, back, support and leader roles from the mob source of truth', () => {
    const definition = ENCOUNTER_CATALOG.find((entry) => entry.key === 'execution-circle')!;
    const claimed = buildClaimedEncounter(mob, scaleEncounter(definition, 5));
    expect(claimed.initialActors).toHaveLength(3);
    expect(claimed.initialActors.map((actor) => actor.formationPreference)).toEqual([
      'FRONT',
      'FRONT',
      'BACK',
    ]);
    expect(claimed.initialActors[0]).toMatchObject({
      actorId: `mob:${mob.id}`,
      name: mob.name,
      kind: 'MOB',
    });
    expect(claimed.pendingActors.size).toBe(3);
  });

  it('uses deterministic AI and returns only commands exposed by CombatEngine.legalActions', () => {
    const firstRun = bloodRiteRuntime();
    const firstActor = firstRun.runtime.actors.find(
      (actor) => actor.actorId === firstRun.scribeActorId,
    )!;
    const firstLegal = firstRun.engine.legalActions(firstRun.runtime, firstRun.scribeActorId);
    const firstPlan = planEncounterAction(
      firstRun.runtime,
      firstActor,
      firstRun.execution.state,
      firstLegal,
    );

    const secondRun = bloodRiteRuntime();
    const secondActor = secondRun.runtime.actors.find(
      (actor) => actor.actorId === secondRun.scribeActorId,
    )!;
    const secondLegal = secondRun.engine.legalActions(secondRun.runtime, secondRun.scribeActorId);
    const secondPlan = planEncounterAction(
      secondRun.runtime,
      secondActor,
      secondRun.execution.state,
      secondLegal,
    );

    expect(firstPlan).toEqual(secondPlan);
    expect(firstPlan?.command).toMatchObject({ action: 'SKILL', skillKey: 'mage-meteor' });
    expect(
      firstLegal.some(
        (action) =>
          action.action === firstPlan?.command.action &&
          action.skillKey === firstPlan?.command.skillKey &&
          (!firstPlan?.command.targetActorId ||
            action.targetActorIds.includes(firstPlan.command.targetActorId)),
      ),
    ).toBe(true);

    firstRun.engine.act(firstRun.runtime, firstRun.scribeActorId, firstPlan!.command, 2_000);
    secondRun.engine.act(secondRun.runtime, secondRun.scribeActorId, secondPlan!.command, 2_000);
    expect(firstRun.engine.snapshot(firstRun.runtime)).toEqual(
      secondRun.engine.snapshot(secondRun.runtime),
    );
  });

  it('runs a telegraph through declaration, legal interrupt and stagger resolution', () => {
    const { engine, runtime, execution, scribeActorId } = bloodRiteRuntime();
    const scribe = runtime.actors.find((actor) => actor.actorId === scribeActorId)!;
    const plan = planEncounterAction(
      runtime,
      scribe,
      execution.state,
      engine.legalActions(runtime, scribeActorId),
    )!;
    const declaration = engine.act(runtime, scribeActorId, plan.command, 2_000);
    const reactorId = declaration.telegraph?.reactionActorIds[0];
    expect(declaration).toMatchObject({
      phase: 'REACTION',
      telegraph: {
        actorId: scribeActorId,
        skillKey: 'mage-meteor',
      },
    });
    expect(reactorId).toBeDefined();
    expect(declaration.legalActionsByActorId?.[reactorId!]).toContainEqual(
      expect.objectContaining({ action: 'INTERRUPT', reactionOnly: true }),
    );

    const interrupted = engine.act(
      runtime,
      reactorId!,
      {
        action: 'INTERRUPT',
        targetActorId: scribeActorId,
        operationId: 'encounter-interrupt-1',
        expectedTurnNumber: runtime.turnNumber,
        contractVersion: 2,
      },
      2_100,
    );
    expect(interrupted.phase).toBe('DECISION');
    expect(interrupted.telegraph).toBeUndefined();
    expect(
      interrupted.participants
        .find((actor) => actor.actorId === scribeActorId)
        ?.statuses.some((status) => status.key === 'STAGGER'),
    ).toBe(true);
    expect(interrupted.recentActions.at(-1)?.skillKey).toBe('tactical:interrupt');
  });

  it('moves through three phases and reaches exactly ten enemies without overflow', () => {
    const { engine, runtime, claimed } = executionRuntime(10);
    const execution = createEncounterExecution(runtime, mob.id, claimed, 77);
    const initialCount = runtime.actors.filter((actor) => actor.kind === 'MOB').length;
    expect(initialCount).toBe(7);
    for (const actor of runtime.actors.filter((candidate) => candidate.kind === 'MOB')) {
      actor.hp = Math.floor(actor.maxHp * 0.5);
    }
    let snapshot = synchronizeEncounter(engine, runtime, execution, 2_000);
    expect(snapshot.encounter?.phaseKey).toBe('blood_rite');
    expect(runtime.actors.filter((actor) => actor.kind === 'MOB')).toHaveLength(9);
    expect(runtime.events.at(-1)?.skillKey).toBe('encounter:summon');

    const root = runtime.actors.find((actor) => actor.actorId === claimed.rootActorId)!;
    root.hp = Math.floor(root.maxHp * 0.2);
    runtime.turnNumber = 14;
    snapshot = synchronizeEncounter(engine, runtime, execution, 3_000);
    expect(snapshot.encounter?.phaseKey).toBe('execution');
    expect(snapshot.encounter?.phaseIndex).toBe(2);
    expect(runtime.actors.filter((actor) => actor.kind === 'MOB')).toHaveLength(10);
  });

  it('counts support contribution while excluding AFK and late participants', () => {
    const { engine, runtime, claimed } = executionRuntime(3);
    const execution = createEncounterExecution(runtime, mob.id, claimed, 91);
    const support = execution.state.contributions.get('player-1')!;
    support.actions = 2;
    support.healing = 40;
    support.protection = 30;
    support.cleanses = 1;
    support.mechanics = 1;
    expect(evaluateEncounterEligibility(runtime, execution.state, 'player-1')).toMatchObject({
      eligible: true,
      reason: 'ELIGIBLE',
    });

    recordEncounterTimeout(execution.state, 'player-2', 2);
    recordEncounterTimeout(execution.state, 'player-2', 3);
    expect(evaluateEncounterEligibility(runtime, execution.state, 'player-2')).toMatchObject({
      eligible: false,
      reason: 'AFK',
    });

    runtime.turnNumber = 10;
    execution.state.contributions.get('player-3')!.joinedTurn = 9;
    expect(evaluateEncounterEligibility(runtime, execution.state, 'player-3')).toMatchObject({
      eligible: false,
      reason: 'LATE_JOIN',
    });
    expect(engine.snapshot(runtime).status).toBe('ACTIVE');
  });

  it('rejects missing skills, unreachable phases and unsafe or illegal compositions', () => {
    const source = ENCOUNTER_CATALOG[1]!;
    const missingSkill = cloneEncounter(source);
    missingSkill.actors[0]!.skillKeys.push('missing-skill');
    expect(validateEncounterDefinition(missingSkill).errors.join('\n')).toContain('missing skill');

    const unreachable = cloneEncounter(source);
    unreachable.phases[1]!.conditions = [];
    expect(validateEncounterDefinition(unreachable).errors.join('\n')).toContain('unreachable');

    const unsafe = cloneEncounter(source);
    unsafe.actors[0]!.skillKeys.push('archer-perfect-hunt');
    expect(validateEncounterDefinition(unsafe).errors.join('\n')).toContain('requires a telegraph');

    const illegal = cloneEncounter(source);
    illegal.scaling[0]!.actorKeys = ['chain-guard'];
    expect(validateEncounterDefinition(illegal).errors.join('\n')).toContain('root actor');
  });
});
