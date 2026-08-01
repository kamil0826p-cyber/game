import type { CombatSnapshot } from '../../../contracts/socket.events.js';
import { CombatEngine } from '../../combat/combat.engine.js';
import {
  COMBAT_EVENT_HISTORY_LIMIT,
  COMBAT_FORMATION_FRONT_SLOTS,
  COMBAT_FORMATION_TOTAL_SLOTS,
  COMBAT_TEAM_LIMIT,
  formationLineForSlot,
} from '../../combat/combat.rules.js';
import type {
  CombatActorInput,
  CombatRuntime,
  CombatRuntimeActor,
} from '../../combat/combat.types.js';
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
  applyFormationPreferences(runtime, rootActor.teamId, claimed.initialActors);
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
  if (runtime.status === 'ACTIVE') transitionPhase(runtime, execution, now);
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
      mechanics: [...new Set([...state.encounter.tier.mechanics, ...phase.mechanics])],
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
  contribution.pendingTimeoutActions += 1;
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
  summonIntoSharedCombat(
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

function summonIntoSharedCombat(
  runtime: CombatRuntime,
  teamId: string,
  inputs: readonly CombatActorInput[],
  now: number,
  label: string,
): void {
  if (runtime.status !== 'ACTIVE' || inputs.length === 0) return;
  const team = runtime.teams.find((candidate) => candidate.teamId === teamId);
  if (!team) throw new Error('ENCOUNTER_SUMMON_TEAM_MISSING');
  const current = runtime.actors.filter((actor) => actor.teamId === teamId);
  if (current.length + inputs.length > COMBAT_TEAM_LIMIT) {
    throw new Error('ENCOUNTER_SUMMON_LIMIT');
  }
  const existingIds = new Set(runtime.actors.map((actor) => actor.actorId));
  if (inputs.some((input) => existingIds.has(input.actorId))) {
    throw new Error('ENCOUNTER_SUMMON_DUPLICATE');
  }
  const occupied = new Set(current.map((actor) => actor.formationSlot));
  const summoned = inputs.map((input) => {
    const slot = allocateFormationSlot(occupied, input.formationPreference);
    occupied.add(slot);
    const {
      formationPreference: _formationPreference,
      skills,
      fallbackAction,
      magicResistance,
      ...base
    } = input;
    return {
      ...base,
      teamId,
      formationSlot: slot,
      formationLine: formationLineForSlot(slot),
      magicResistance: magicResistance ?? Math.max(0, Math.round(input.armor * 0.35)),
      fallbackAction: fallbackAction ?? 'DEFEND',
      withdrawn: false,
      controlDrStacks: 0,
      controlDrExpiresTurn: 0,
      statuses: [],
      skills: new Map(
        skills.map((skill) => [
          skill.definition.key,
          {
            definition: skill.definition,
            cooldownTurnsRemaining: skill.cooldownTurnsRemaining,
          },
        ]),
      ),
    } satisfies CombatRuntimeActor;
  });
  runtime.actors.push(...summoned);
  team.actorIds.push(...summoned.map((actor) => actor.actorId));
  runtime.turnOrder.push(...summoned.map((actor) => actor.actorId));
  runtime.events.push({
    sequence: runtime.nextSequence++,
    actorId: team.anchorActorId,
    action: 'SKILL',
    skillKey: 'encounter:summon',
    label,
    animationKey: 'encounter-summon',
    visual: {
      castEffectKey: 'encounter-summon:cast',
      impactEffectKey: 'encounter-summon:impact',
      accentColor: '#a78bfa',
    },
    results: summoned.map((actor) => ({
      targetActorId: actor.actorId,
      hpDelta: 0,
      energyDelta: 0,
      shieldDelta: 0,
      shieldAbsorbed: 0,
      dodged: false,
      statusesApplied: [],
      statusesRemoved: [],
    })),
    occurredAt: now,
  });
  if (runtime.events.length > COMBAT_EVENT_HISTORY_LIMIT) {
    runtime.events.splice(0, runtime.events.length - COMBAT_EVENT_HISTORY_LIMIT);
  }
}

function applyFormationPreferences(
  runtime: CombatRuntime,
  teamId: string,
  inputs: readonly CombatActorInput[],
): void {
  const occupied = new Set<number>();
  for (const input of inputs) {
    const actor = runtime.actors.find(
      (candidate) => candidate.teamId === teamId && candidate.actorId === input.actorId,
    );
    if (!actor) continue;
    const slot = allocateFormationSlot(occupied, input.formationPreference);
    occupied.add(slot);
    actor.formationSlot = slot;
    actor.formationLine = formationLineForSlot(slot);
  }
}

function allocateFormationSlot(
  occupied: ReadonlySet<number>,
  preference?: 'FRONT' | 'BACK',
): number {
  const preferred =
    preference === 'BACK'
      ? range(COMBAT_FORMATION_FRONT_SLOTS, COMBAT_FORMATION_TOTAL_SLOTS)
      : preference === 'FRONT'
        ? range(0, COMBAT_FORMATION_FRONT_SLOTS)
        : range(0, COMBAT_FORMATION_TOTAL_SLOTS);
  const fallback = range(0, COMBAT_FORMATION_TOTAL_SLOTS);
  const slot = [...preferred, ...fallback].find((candidate) => !occupied.has(candidate));
  if (slot === undefined) throw new Error('ENCOUNTER_FORMATION_FULL');
  return slot;
}

function range(start: number, end: number): number[] {
  return Array.from({ length: Math.max(0, end - start) }, (_, index) => start + index);
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
    const timeoutFallback = contribution.pendingTimeoutActions > 0;
    if (timeoutFallback) {
      contribution.pendingTimeoutActions -= 1;
      state.processedEventSequence = Math.max(state.processedEventSequence, event.sequence);
      continue;
    }
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
    pendingTimeoutActions: 0,
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
