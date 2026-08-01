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
      observedTelegraphs: new Map(),
      resolvedTelegraphs: [],
      interactions: new Set(),
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
  observeTelegraph(runtime, execution.state);
  ingestEncounterRuntimeEvents(runtime, execution.state);
  if (runtime.status === 'ACTIVE') applyEncounterOutcome(engine, runtime, execution.state, now);
  if (runtime.status === 'ACTIVE') transitionPhase(runtime, execution, now);
  ingestEncounterRuntimeEvents(runtime, execution.state);
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

export function recordEncounterInteraction(
  state: EncounterRuntimeState,
  interactionKey: string,
): void {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(interactionKey)) {
    throw new Error('ENCOUNTER_INTERACTION_INVALID');
  }
  state.interactions.add(interactionKey);
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
  if (score < state.encounter.definition.reward.minimumContribution) {
    return { eligible: false, reason: 'NO_CONTRIBUTION', score, activeTurnRatio };
  }
  return { eligible: true, reason: 'ELIGIBLE', score, activeTurnRatio };
}

export function encounterRewardOperationId(combatId: string): string {
  return `encounter:${combatId}`;
}

function applyEncounterOutcome(
  engine: CombatEngine,
  runtime: CombatRuntime,
  state: EncounterRuntimeState,
  now: number,
): void {
  const defeat = state.encounter.definition.defeat;
  if (
    defeat.type === 'TURN_LIMIT' &&
    defeat.turnLimit !== undefined &&
    runtime.turnNumber >= defeat.turnLimit
  ) {
    forfeitTeam(engine, runtime, state.playerTeamId, now);
    return;
  }

  const victory = state.encounter.definition.victory;
  if (victory.type !== 'DEFEAT_ACTOR' || !victory.actorKey) return;
  const actorId = state.actorIdByKey.get(victory.actorKey);
  const target = actorId
    ? runtime.actors.find((actor) => actor.actorId === actorId)
    : undefined;
  if (target && !canFight(target)) {
    forfeitTeam(engine, runtime, state.enemyTeamId, now);
    if (runtime.status === 'FINISHED' && runtime.winnerTeamId === state.playerTeamId) {
      runtime.finishReason = 'DEFEATED';
    }
  }
}

function forfeitTeam(
  engine: CombatEngine,
  runtime: CombatRuntime,
  teamId: string,
  now: number,
): void {
  const actorIds = runtime.actors
    .filter((actor) => actor.teamId === teamId && canFight(actor))
    .map((actor) => actor.actorId);
  for (const actorId of actorIds) {
    if (runtime.status !== 'ACTIVE') break;
    engine.forfeit(runtime, actorId, now);
  }
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
  appendPhaseEvent(runtime, execution.state, next.label, now);

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

function appendPhaseEvent(
  runtime: CombatRuntime,
  state: EncounterRuntimeState,
  label: string,
  now: number,
): void {
  const root = runtime.actors.find((actor) => actor.actorId === state.rootActorId);
  runtime.events.push({
    sequence: runtime.nextSequence++,
    actorId: state.rootActorId,
    targetActorId: state.rootActorId,
    action: 'SKILL',
    skillKey: 'encounter:phase',
    label: `Faza: ${label}`,
    animationKey: 'encounter-phase',
    visual: {
      castEffectKey: 'encounter-phase:cast',
      impactEffectKey: 'encounter-phase:impact',
      accentColor: '#f59e0b',
    },
    results: root ? [emptyRuntimeResult(root.actorId)] : [],
    occurredAt: now,
  });
  trimEventHistory(runtime);
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
    results: summoned.map((actor) => emptyRuntimeResult(actor.actorId)),
    occurredAt: now,
  });
  trimEventHistory(runtime);
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
      const actor = actorForKey(runtime, state, condition.actorKey);
      return Boolean(actor && actor.hp / Math.max(1, actor.maxHp) <= condition.ratio);
    }
    case 'ACTOR_DEFEATED': {
      const actor = actorForKey(runtime, state, condition.actorKey);
      return Boolean(actor && !canFight(actor));
    }
    case 'TELEGRAPH_RESOLVED':
      return state.resolvedTelegraphs.some(
        (resolution) =>
          resolution.skillKey === condition.skillKey &&
          resolution.interrupted === condition.interrupted,
      );
    case 'STATUS_ACTIVE': {
      const actor = actorForKey(runtime, state, condition.actorKey);
      return Boolean(
        actor?.statuses.some(
          (status) => status.key === condition.statusKey && status.turnsRemaining > 0,
        ),
      );
    }
    case 'BREAK_AT_LEAST': {
      const actor = actorForKey(runtime, state, condition.actorKey);
      if (!actor) return false;
      const staggerStacks = actor.statuses.filter(
        (status) => status.key === 'STAGGER' && status.turnsRemaining > 0,
      ).length;
      return Math.max(actor.controlDrStacks, staggerStacks) >= condition.stacks;
    }
    case 'LIVING_PLAYERS_AT_MOST':
      return runtime.actors.filter(
        (actor) => actor.teamId === state.playerTeamId && canFight(actor),
      ).length <= condition.count;
    case 'INTERACTION_USED':
      return state.interactions.has(condition.interactionKey);
  }
}

function actorForKey(
  runtime: CombatRuntime,
  state: EncounterRuntimeState,
  actorKey: string,
): CombatRuntimeActor | undefined {
  const actorId = state.actorIdByKey.get(actorKey);
  return actorId
    ? runtime.actors.find((candidate) => candidate.actorId === actorId)
    : undefined;
}

function observeTelegraph(runtime: CombatRuntime, state: EncounterRuntimeState): void {
  if (!runtime.telegraph) return;
  state.observedTelegraphs.set(runtime.telegraph.actorId, runtime.telegraph.skillKey);
}

export function ingestEncounterRuntimeEvents(
  runtime: CombatRuntime,
  state: EncounterRuntimeState,
): void {
  const events = runtime.events.filter((event) => event.sequence > state.processedEventSequence);
  const telegraphSkills = new Set(
    state.encounter.definition.telegraphs.map((rule) => rule.skillKey),
  );
  for (const event of events) {
    if (event.skillKey === 'tactical:interrupt') {
      const casterId = event.targetActorId ?? event.results[0]?.targetActorId;
      const skillKey = casterId ? state.observedTelegraphs.get(casterId) : undefined;
      if (skillKey) {
        recordTelegraphResolution(state, skillKey, true, runtime.turnNumber);
        state.observedTelegraphs.delete(casterId!);
      }
    } else if (event.skillKey && telegraphSkills.has(event.skillKey)) {
      recordTelegraphResolution(state, event.skillKey, false, runtime.turnNumber);
      state.observedTelegraphs.delete(event.actorId);
    }

    const source = runtime.actors.find((actor) => actor.actorId === event.actorId);
    const sourceContribution =
      source?.kind === 'PLAYER'
        ? ensureContribution(state, source.actorId, runtime.turnNumber)
        : undefined;
    const timeoutFallback = Boolean(
      sourceContribution && sourceContribution.pendingTimeoutActions > 0,
    );

    if (sourceContribution && timeoutFallback) {
      sourceContribution.pendingTimeoutActions -= 1;
    } else if (sourceContribution && source) {
      if (!['STATUS_TICK', 'TURN_SKIPPED'].includes(event.action)) {
        sourceContribution.actions += 1;
      }
      for (const result of event.results) {
        const target = runtime.actors.find((actor) => actor.actorId === result.targetActorId);
        if (!target) continue;
        if (target.teamId !== source.teamId && result.hpDelta < 0) {
          sourceContribution.damage += Math.abs(result.hpDelta);
        }
        if (target.teamId === source.teamId && result.hpDelta > 0) {
          sourceContribution.healing += result.hpDelta;
        }
        if (result.shieldDelta > 0) {
          sourceContribution.protection += result.shieldDelta;
        }
      }
      if (event.skillKey === 'tactical:interrupt') sourceContribution.interrupts += 1;
      if (event.skillKey === 'tactical:cleanse') sourceContribution.cleanses += 1;
      if (
        event.skillKey &&
        ['tactical:intercept', 'tactical:reposition', 'tactical:mark', 'tactical:taunt'].includes(
          event.skillKey,
        )
      ) {
        sourceContribution.mechanics += 1;
      }
    }

    for (const result of event.results) {
      const target = runtime.actors.find((actor) => actor.actorId === result.targetActorId);
      if (
        result.interceptedByActorId &&
        result.hpDelta < 0
      ) {
        const interceptor = runtime.actors.find(
          (actor) => actor.actorId === result.interceptedByActorId,
        );
        if (interceptor?.kind === 'PLAYER') {
          ensureContribution(state, interceptor.actorId, runtime.turnNumber).protection += Math.abs(
            result.hpDelta,
          );
        }
      }
      if ((result.counterDamage ?? 0) > 0 && target?.kind === 'PLAYER') {
        ensureContribution(state, target.actorId, runtime.turnNumber).damage +=
          result.counterDamage ?? 0;
      }
    }

    state.processedEventSequence = Math.max(state.processedEventSequence, event.sequence);
  }
}

function recordTelegraphResolution(
  state: EncounterRuntimeState,
  skillKey: string,
  interrupted: boolean,
  turn: number,
): void {
  const duplicate = state.resolvedTelegraphs.some(
    (resolution) =>
      resolution.skillKey === skillKey &&
      resolution.interrupted === interrupted &&
      resolution.turn === turn,
  );
  if (!duplicate) state.resolvedTelegraphs.push({ skillKey, interrupted, turn });
  if (state.resolvedTelegraphs.length > 32) {
    state.resolvedTelegraphs.splice(0, state.resolvedTelegraphs.length - 32);
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

function emptyRuntimeResult(targetActorId: string) {
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

function trimEventHistory(runtime: CombatRuntime): void {
  if (runtime.events.length > COMBAT_EVENT_HISTORY_LIMIT) {
    runtime.events.splice(0, runtime.events.length - COMBAT_EVENT_HISTORY_LIMIT);
  }
}

function canFight(actor: CombatRuntimeActor): boolean {
  return actor.hp > 0 && !actor.withdrawn;
}
