import type {
  CombatActionCommand,
  CombatLegalAction,
  CombatRuntime,
  CombatRuntimeActor,
} from '../../combat/combat.types.js';
import type {
  EncounterAiPlan,
  EncounterActorTemplate,
  EncounterRuntimeState,
  EncounterTargetPolicy,
} from './encounter.types.js';

export type EncounterRandom = () => number;

export function createSeededRandom(seed: number | string): EncounterRandom {
  let state = typeof seed === 'number' ? seed >>> 0 : hashSeed(seed);
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

export function planEncounterAction(
  runtime: CombatRuntime,
  actor: CombatRuntimeActor,
  state: EncounterRuntimeState,
  legalActions: readonly CombatLegalAction[],
): EncounterAiPlan | undefined {
  if (legalActions.length === 0) return undefined;
  const actorKey = state.actorKeyById.get(actor.actorId);
  const template = state.encounter.definition.actors.find(
    (candidate) => candidate.key === actorKey,
  );
  if (!template) return undefined;
  const availableActions =
    runtime.phase === 'REACTION'
      ? [...legalActions]
      : filterRedundantEncounterActions(runtime, actor, legalActions);
  if (availableActions.length === 0) return undefined;
  const phase = state.encounter.definition.phases[state.phaseIndex];
  const random = createSeededRandom(
    `${state.seed}:${runtime.combatId}:${runtime.turnNumber}:${actor.actorId}:${state.phaseKey}`,
  );

  if (runtime.phase === 'REACTION') {
    const interrupt = availableActions.find((action) => action.action === 'INTERRUPT');
    if (interrupt)
      return commandFor(
        runtime,
        actor,
        state,
        interrupt,
        template,
        random,
        'interrupt telegraph',
      );
    const defend = availableActions.find((action) => action.action === 'DEFEND');
    if (defend)
      return commandFor(
        runtime,
        actor,
        state,
        defend,
        template,
        random,
        'defend against telegraph',
      );
  }

  if (phase?.mechanics.includes('METEOR_TELEGRAPH')) {
    const meteor = availableActions.find(
      (action) => action.action === 'SKILL' && action.skillKey === 'mage-meteor',
    );
    if (meteor)
      return commandFor(
        runtime,
        actor,
        state,
        meteor,
        template,
        random,
        'scripted phase telegraph',
      );
  }

  const phasePriority = template.ai.phaseActionPriority?.[state.phaseKey] ?? [];
  for (const action of phasePriority) {
    const legal = availableActions.find((candidate) => candidate.action === action);
    if (legal)
      return commandFor(
        runtime,
        actor,
        state,
        legal,
        template,
        random,
        `phase priority ${action}`,
      );
  }

  const rolePriority = roleActions(template);
  for (const action of rolePriority) {
    const legal = availableActions.find((candidate) => candidate.action === action);
    if (legal)
      return commandFor(
        runtime,
        actor,
        state,
        legal,
        template,
        random,
        `role priority ${action}`,
      );
  }

  const weighted = availableActions
    .map((action) => ({
      action,
      weight: Math.max(
        0,
        template.ai.actionWeights[action.action] ?? defaultWeight(action),
      ),
    }))
    .filter((entry) => entry.weight > 0);
  const selected = pickWeighted(weighted, random)?.action ?? availableActions[0];
  return selected
    ? commandFor(
        runtime,
        actor,
        state,
        selected,
        template,
        random,
        'weighted legal action',
      )
    : undefined;
}

export function filterRedundantEncounterActions(
  runtime: CombatRuntime,
  actor: CombatRuntimeActor,
  legalActions: readonly CombatLegalAction[],
): CombatLegalAction[] {
  return legalActions.flatMap((action) => {
    if (action.action === 'DEFEND') {
      return hasActiveStatus(actor, 'GUARD') ? [] : [action];
    }
    if (action.action === 'COUNTER') {
      return hasActiveStatus(actor, 'COUNTER_READY') ? [] : [action];
    }
    if (!['MARK', 'TAUNT', 'INTERCEPT'].includes(action.action)) return [action];

    const blockingStatus =
      action.action === 'MARK'
        ? 'EXPOSED'
        : action.action === 'TAUNT'
          ? 'TAUNT'
          : 'PROTECTED';
    const targetActorIds = action.targetActorIds.filter((actorId) => {
      const target = runtime.actors.find((candidate) => candidate.actorId === actorId);
      return Boolean(target && !hasActiveStatus(target, blockingStatus));
    });
    return targetActorIds.length > 0 ? [{ ...action, targetActorIds }] : [];
  });
}

function hasActiveStatus(actor: CombatRuntimeActor, statusKey: string): boolean {
  return actor.statuses.some(
    (status) => status.key === statusKey && status.turnsRemaining > 0,
  );
}

function roleActions(
  template: EncounterActorTemplate,
): CombatActionCommand['action'][] {
  switch (template.role) {
    case 'FRONTLINER':
      return ['INTERCEPT', 'TAUNT'];
    case 'SUPPORT':
      return ['CLEANSE', 'TRANSFER_ENERGY', 'INTERCEPT', 'MARK'];
    case 'EXECUTIONER':
      return ['MARK', 'SKILL', 'BASIC_ATTACK'];
    case 'LEADER':
      return ['SKILL', 'MARK', 'BASIC_ATTACK'];
    case 'OBJECTIVE':
      return ['DEFEND', 'SKIP'];
    case 'SUMMON':
    default:
      return ['SKILL', 'BASIC_ATTACK', 'DEFEND'];
  }
}

function commandFor(
  runtime: CombatRuntime,
  actor: CombatRuntimeActor,
  state: EncounterRuntimeState,
  legal: CombatLegalAction,
  template: EncounterActorTemplate,
  random: EncounterRandom,
  reason: string,
): EncounterAiPlan {
  const targetActorId = selectTarget(
    runtime,
    actor,
    legal.targetActorIds,
    template.ai.targetPolicy,
    state,
    random,
  );
  return {
    command: {
      action: legal.action,
      skillKey: legal.skillKey,
      targetActorId,
      operationId: `encounter-ai:${runtime.combatId}:${runtime.turnNumber}:${actor.actorId}:${state.phaseKey}`,
      expectedTurnNumber: runtime.turnNumber,
      contractVersion: 2,
    },
    reason: `${template.role}/${template.ai.targetPolicy}: ${reason}${targetActorId ? ` -> ${targetActorId}` : ''}`,
  };
}

function selectTarget(
  runtime: CombatRuntime,
  actor: CombatRuntimeActor,
  targetActorIds: readonly string[],
  policy: EncounterTargetPolicy,
  state: EncounterRuntimeState,
  random: EncounterRandom,
): string | undefined {
  const candidates = targetActorIds
    .map((actorId) =>
      runtime.actors.find((candidate) => candidate.actorId === actorId),
    )
    .filter(
      (candidate): candidate is CombatRuntimeActor => Boolean(candidate),
    );
  if (candidates.length === 0) return undefined;
  const leaderKey = state.encounter.definition.actors.find(
    (candidate) => candidate.role === 'LEADER',
  )?.key;
  const leaderId = leaderKey ? state.actorIdByKey.get(leaderKey) : undefined;
  const sorted = [...candidates];
  switch (policy) {
    case 'FRONT_LINE': {
      const front = sorted.filter(
        (candidate) => candidate.formationLine === 'FRONT',
      );
      return (front[0] ?? sorted[0])?.actorId;
    }
    case 'BACK_LINE': {
      const back = sorted.filter(
        (candidate) => candidate.formationLine === 'BACK',
      );
      return pick(back.length > 0 ? back : sorted, random)?.actorId;
    }
    case 'LOWEST_HP':
      return sorted.sort(byHealthRatio)[0]?.actorId;
    case 'HIGHEST_HP':
      return sorted.sort((left, right) => byHealthRatio(right, left))[0]?.actorId;
    case 'LOWEST_RESOURCE':
      return sorted.sort(byEnergyRatio)[0]?.actorId;
    case 'HIGHEST_RESOURCE':
      return sorted.sort((left, right) => byEnergyRatio(right, left))[0]?.actorId;
    case 'MARKED_OR_EXPOSED': {
      const marked = sorted.find((candidate) =>
        candidate.statuses.some((status) =>
          ['EXPOSED', 'DAMAGE_TAKEN_INCREASE', 'STAGGER'].includes(status.key),
        ),
      );
      return (marked ?? sorted.sort(byHealthRatio)[0])?.actorId;
    }
    case 'PROTECT_LEADER':
      return (
        sorted.find((candidate) => candidate.actorId === leaderId)?.actorId ??
        sorted.sort(byHealthRatio)[0]?.actorId
      );
    case 'INTERRUPT_TELEGRAPH':
      return runtime.telegraph?.actorId &&
        targetActorIds.includes(runtime.telegraph.actorId)
        ? runtime.telegraph.actorId
        : sorted[0]?.actorId;
    case 'REPOSITION': {
      const wrongLine = sorted.find(
        (candidate) =>
          candidate.teamId === actor.teamId &&
          candidate.formationLine !== actor.formationLine,
      );
      return (wrongLine ?? sorted[0])?.actorId;
    }
    case 'RANDOM_LEGAL':
    default:
      return pick(sorted, random)?.actorId;
  }
}

function byHealthRatio(
  left: CombatRuntimeActor,
  right: CombatRuntimeActor,
): number {
  return left.hp / Math.max(1, left.maxHp) - right.hp / Math.max(1, right.maxHp);
}

function byEnergyRatio(
  left: CombatRuntimeActor,
  right: CombatRuntimeActor,
): number {
  return (
    left.energy / Math.max(1, left.maxEnergy) -
    right.energy / Math.max(1, right.maxEnergy)
  );
}

function defaultWeight(action: CombatLegalAction): number {
  if (action.action === 'SKILL') return 3;
  if (action.action === 'BASIC_ATTACK') return 2;
  if (action.action === 'DEFEND') return 1;
  return 0.75;
}

function pickWeighted<T extends { weight: number }>(
  entries: readonly T[],
  random: EncounterRandom,
): T | undefined {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (total <= 0) return undefined;
  let roll = random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry;
  }
  return entries.at(-1);
}

function pick<T>(
  entries: readonly T[],
  random: EncounterRandom,
): T | undefined {
  if (entries.length === 0) return undefined;
  return entries[
    Math.min(entries.length - 1, Math.floor(random() * entries.length))
  ];
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
