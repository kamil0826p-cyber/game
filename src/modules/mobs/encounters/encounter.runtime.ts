import type { CombatSnapshot } from '../../../contracts/socket.events.js';
import { CombatEngine } from '../../combat/combat.engine.js';
import type { CombatRuntime, CombatRuntimeActor } from '../../combat/combat.types.js';
import { encounterActorId } from './encounter.actor-factory.js';
import type {
  ClaimedEncounter,
  EncounterContribution,
  EncounterEligibility,
  EncounterExecution,
  EncounterPhaseCondition,
  EncounterRuntimeState,
} from './encounter.types.js';

export function createEncounterExecution(
  runtime: CombatRuntime,
  rootMobId: string,
  claimed: ClaimedEncounter,
  seed: number,
): EncounterExecution {
  const rootActor = runtime.actors.find((actor) => actor.actorId === claimed.rootActorId);
  const player = runtime.actors.find((actor) => actor.kind === 'PLAYER');
  if (!rootActor || !player) throw new Error('ENCOUNTER_RUNTIME_INVALID');
  const rootKey = claimed.encounter.definition.initialActorKeys[0]!;
  const actorIdByKey = new Map<string, string>();
  const actorKeyById = new Map<string, string>();
  for (const actor of claimed.encounter.definition.actors) {
    const actorId = encounterActorId(rootMobId, actor.key, rootKey);
    actorIdByKey.set(actor.key, actorId);
    actorKeyById.set(actorId, actor.key);
  }
  const contributions = new Map<string, EncounterContribution>();
  for (const actor of runtime.actors.filter((candidate) => candidate.kind === 'PLAYER')) {
    contributions.set(actor.actorId, emptyContribution(actor.actorId, runtime.turnNumber));
  }
  const opening = claimed.encounter.definition.phases[0];
  if (!opening) throw new Error('ENCOUNTER_PHASE_MISSING');
  return {
    pendingActors: new Map(claimed.pendingActors),
    state: {
      encounter: claimed.encounter,
      rootMobId,
      rootActorId: claimed.rootActorId,
      enemyTeamId: rootActor.teamId,
      playerTeamId: player.teamId,
      phaseIndex: 0,
      phaseKey: opening.key,
      arenaModifier: opening.arenaModifier,
      processedEventSequence: 0,
      summonedActorKeys: new Set(),
      actorIdByKey,
      actorKeyById,
      contributions,
      aiTrace: [],
      seed,
    },
  };
}

export function synchronizeEncounter(
  engine: CombatEngine,
  runtime: CombatRuntime,
  execution: EncounterExecution,
  now: number,
): CombatSnapshot {
  ingestContributions(runtime, execution.state);
  if (runtime.status === 'ACTIVE') transitionPhase(engine, runtime, execution, now);
  ingestContributions(runtime, execution.state);
  return decorateEncounterSnapshot(engine.snapshot(runtime), runtime, execution.state);
}

export function decorateEncounterSnapshot(
  snapshot: CombatSnapshot,
  runtime: CombatRuntime,
  state: EncounterRuntimeState,
): CombatSnapshot {
  const phase = state.encounter.definition.phases[state.phaseIndex]!;
  const eligibility =
    runtime.status === 'FINISHED'
      ? Object.fromEntries(
          runtime.actors
            .filter((actor) => actor.kind === 'PLAYER')
            .map((actor) => [actor.actorId, evaluateEncounterEligibility(runtime, state, actor.actorId)]),
        )
      : undefined;
  return {
    ...snapshot,
    encounter: {
      key: state.encounter.definition.key,
      version: state.encounter.definition.version,
      name: state.encounter.definition.name,
      difficulty: state.encounter.definition.difficulty,
      rootMobId: state.rootMobId,
      phaseKey: state.phaseKey,
      phaseLabel: phase.label,
      phaseIndex: state.phaseIndex,
      phaseCount: state.encounter.definition.phases.length,
      arenaModifier: state.arenaModifier,
      mechanics: [
        ...new Set([...state.encounter.tier.mechanics, ...phase.mechanics]),
      ],
      partySize: state.encounter.partySize,
      recommendedPartySize: state.encounter.definition.recommendedPartySize,
      minimumPartySize: state.encounter.definition.minimumPartySize,
      maximumPartySize: state.encounter.definition.maximumPartySize,
      scaling: {
        healthMultiplier: state.encounter.tier.healthMultiplier,
        powerMultiplier: state.encounter.tier.powerMultiplier,
        telegraphTargetCount: state.encounter.tier.telegraphTargetCount,
        breakCapacity: state.encounter.tier.breakCapacity,
        targetTurns: state.encounter.tier.targetTurns,
      },
      eligibility,
    },
  };
}

export function appendEncounterAiTrace(state: EncounterRuntimeState, trace: string): void {
  state.aiTrace.push(trace);
  if (state.aiTrace.length > 64) state.aiTrace.splice(0, state.aiTrace.length - 64);
}

export function recordEncounterTimeout(
  state: EncounterRuntimeState,
  actorId: string,
  currentTurn: number,
): void {
  const contribution = ensureContribution(state, actorId, currentTurn);
  contribution.timedOutTurns += 1;
}

export function evaluateEncounterEligibility(
  runtime: CombatRuntime,
  state: EncounterRuntimeState,
  actorId: string,
): EncounterEligibility {
  const actor = runtime.actors.find((candidate) => candidate.actorId === actorId);
  const contribution = ensureContribution(state, actorId, runtime.turnNumber);
  const decisions = contribution.actions + contribution.timedOutTurns;
  const activeTurnRatio = decisions > 0 ? contribution.actions / decisions : 0;
  const score = Math.round(
    contribution.damage +
      contribution.healing +
      contribution.protection +
      contribution.interrupts * 25 +
      contribution.cleanses * 15 +
      contribution.mechanics * 10,
  );
  if (actor?.withdrawn) return { eligible: false, reason: 'WITHDRAWN', score, activeTurnRatio };
  if (
    contribution.joinedTurn >
    Math.max(1, Math.floor(runtime.turnNumber * state.encounter.definition.reward.lateJoinCutoff))
  ) {
    return { eligible: false, reason: 'LATE_JOIN', score, activeTurnRatio };
  }
  if (
    decisions >= 2 &&
    activeTurnRatio < state.encounter.definition.reward.minimumActiveTurnRatio
  ) {
    return { eligible: false, reason: 'AFK', score, activeTurnRatio };
  }
  if (
    score < state.encounter.definition.reward.minimumContribution &&
    contribution.actions === 0
  ) {
    return { eligible: false, reason: 'NO_CONTRIBUTION', score, activeTurnRatio };
  }
  return { eligible: true, reason: 'ELIGIBLE', score, activeTurnRatio };
}

export function encounterRewardOperationId(combatId: string): string {
  return `encounter:${combatId}`;
}

function transitionPhase(
  engine: CombatEngine,
  runtime: CombatRuntime,
  execution: EncounterExecution,
  now: number,
): void {
  const nextIndex = execution.state.phaseIndex + 1;
  const next = execution.state.encounter.definition.phases[nextIndex];
  if (!next || !next.conditions.some((condition) => conditionMatches(runtime, execution.state, condition))) {
    return;
  }
  execution.state.phaseIndex = nextIndex;
  execution.state.phaseKey = next.key;
  execution.state.arenaModifier = next.arenaModifier;

  const summonAllowance =
    execution.state.encounter.partySize >= 10
      ? 3
      : execution.state.encounter.partySize >= 5
        ? 2
        : execution.state.encounter.partySize >= 3
          ? 1
          : 0;
  const remainingAllowance = Math.max(
    0,
    Math.min(execution.state.encounter.definition.summonLimit, summonAllowance) -
      execution.state.summonedActorKeys.size,
  );
  const candidates = (next.summonActorKeys ?? [])
    .filter((actorKey) => !execution.state.summonedActorKeys.has(actorKey))
    .flatMap((actorKey) => {
      const actor = execution.pendingActors.get(actorKey);
      return actor ? [{ actorKey, actor }] : [];
    })
    .slice(0, remainingAllowance);
  if (candidates.length === 0) return;
  engine.summon(
    runtime,
    execution.state.enemyTeamId,
    candidates.map((entry) => entry.actor),
    now,
    `Faza: ${next.label}`,
  );
  for (const candidate of candidates) {
    execution.state.summonedActorKeys.add(candidate.actorKey);
    execution.pendingActors.delete(candidate.actorKey);
  }
}

function conditionMatches(
  runtime: CombatRuntime,
  state: EncounterRuntimeState,
  condition: EncounterPhaseCondition,
): boolean {
  switch (condition.type) {
    case 'TURN_AT_LEAST':
      return runtime.turnNumber >= condition.turn;
    case 'ENEMY_HP_AT_MOST': {
      const enemies = runtime.actors.filter((actor) => actor.teamId === state.enemyTeamId);
      const current = enemies.reduce((sum, actor) => sum + Math.max(0, actor.hp), 0);
      const maximum = enemies.reduce((sum, actor) => sum + Math.max(1, actor.maxHp), 0);
      return current / Math.max(1, maximum) <= condition.ratio;
    }
    case 'ACTOR_HP_AT_MOST': {
      const actorId = state.actorIdByKey.get(condition.actorKey);
      const actor = actorId ? runtime.actors.find((candidate) => candidate.actorId === actorId) : undefined;
      return Boolean(actor && actor.hp / Math.max(1, actor.maxHp) <= condition.ratio);
    }
    case 'ACTOR_DEFEATED': {
      const actorId = state.actorIdByKey.get(condition.actorKey);
      const actor = actorId ? runtime.actors.find((candidate) => candidate.actorId === actorId) : undefined;
      return Boolean(actor && (actor.hp <= 0 || actor.withdrawn));
    }
    case 'LIVING_PLAYERS_AT_MOST':
      return runtime.actors.filter(
        (actor) => actor.teamId === state.playerTeamId && canFight(actor),
      ).length <= condition.count;
  }
}

function ingestContributions(runtime: CombatRuntime, state: EncounterRuntimeState): void {
  const events = runtime.events.filter((event) => event.sequence > state.processedEventSequence);
  for (const event of events) {
    const source = runtime.actors.find((actor) => actor.actorId === event.actorId);
    if (!source || source.kind !== 'PLAYER') {
      state.processedEventSequence = Math.max(state.processedEventSequence, event.sequence);
      continue;
    }
    const contribution = ensureContribution(state, source.actorId, runtime.turnNumber);
    if (!['STATUS_TICK', 'TURN_SKIPPED'].includes(event.action)) contribution.actions += 1;
    for (const result of event.results) {
      const target = runtime.actors.find((actor) => actor.actorId === result.targetActorId);
      if (!target) continue;
      if (target.teamId !== source.teamId && result.hpDelta < 0) {
        contribution.damage += Math.abs(result.hpDelta);
      }
      if (target.teamId === source.teamId && result.hpDelta > 0) {
        contribution.healing += result.hpDelta;
      }
      if (result.shieldDelta > 0) contribution.protection += result.shieldDelta;
      if (result.interceptedByActorId) contribution.protection += Math.abs(Math.min(0, result.hpDelta));
    }
    if (event.skillKey === 'tactical:interrupt') contribution.interrupts += 1;
    if (event.skillKey === 'tactical:cleanse') contribution.cleanses += 1;
    if (
      event.skillKey &&
      ['tactical:intercept', 'tactical:reposition', 'tactical:mark', 'tactical:taunt'].includes(
        event.skillKey,
      )
    ) {
      contribution.mechanics += 1;
    }
    state.processedEventSequence = Math.max(state.processedEventSequence, event.sequence);
  }
}

function ensureContribution(
  state: EncounterRuntimeState,
  actorId: string,
  currentTurn: number,
): EncounterContribution {
  const existing = state.contributions.get(actorId);
  if (existing) return existing;
  const created = emptyContribution(actorId, currentTurn);
  state.contributions.set(actorId, created);
  return created;
}

function emptyContribution(actorId: string, joinedTurn: number): EncounterContribution {
  return {
    actorId,
    joinedTurn,
    actions: 0,
    timedOutTurns: 0,
    damage: 0,
    healing: 0,
    protection: 0,
    interrupts: 0,
    cleanses: 0,
    mechanics: 0,
  };
}

function canFight(actor: CombatRuntimeActor): boolean {
  return actor.hp > 0 && !actor.withdrawn;
}
