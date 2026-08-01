import { CombatEngine } from '../modules/combat/combat.engine.js';
import type { CombatActorInput, CombatRuntime } from '../modules/combat/combat.types.js';
import {
  PROGRESSION_NODES,
  calculateCharacterStats,
  progressionPointsForLevel,
} from '../modules/progression/character-stats.js';
import {
  PROGRESSION_NODE_KEYS,
  type ProgressionNodeKey,
} from '../modules/progression/progression.types.js';
import { createDeterministicRandom } from './balance-simulator.js';

export interface ProgressionSimulationCase {
  level: number;
  teamSize: number;
  attackerClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  attackerNode: ProgressionNodeKey;
  defenderClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  defenderNode: ProgressionNodeKey;
  runs: number;
  seed: number;
  maximumActions: number;
}

export interface ProgressionSimulationResult extends ProgressionSimulationCase {
  attackerWins: number;
  defenderWins: number;
  timeouts: number;
  averageActions: number;
  minimumActions: number;
  maximumObservedActions: number;
  controlled: boolean;
}

function choices(level: number, primaryNode: ProgressionNodeKey): ProgressionNodeKey[] {
  let remaining = progressionPointsForLevel(level);
  const result: ProgressionNodeKey[] = [];
  const priority = [primaryNode, ...PROGRESSION_NODE_KEYS.filter((key) => key !== primaryNode)];
  for (const node of priority) {
    const ranks = Math.min(remaining, PROGRESSION_NODES[node].maxRank);
    result.push(...Array.from({ length: ranks }, () => node));
    remaining -= ranks;
    if (remaining === 0) break;
  }
  if (remaining > 0) throw new Error(`Progression nodes cannot spend ${remaining} point(s) at level ${level}.`);
  return result;
}

function actor(
  side: 'a' | 'b',
  index: number,
  characterClass: ProgressionSimulationCase['attackerClass'],
  level: number,
  node: ProgressionNodeKey,
): CombatActorInput {
  const stats = calculateCharacterStats({
    characterClass,
    level,
    choices: choices(level, node),
    freeRespecs: 0,
  }).effective;
  return {
    actorId: `${side}-${index}`,
    kind: 'PLAYER',
    characterId: `${side}-character-${index}`,
    name: `${characterClass}-${node}-${index}`,
    characterClass,
    level,
    outfitKey: `simulation-${characterClass.toLowerCase()}`,
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    energy: stats.maxEnergy,
    maxEnergy: stats.maxEnergy,
    strength: stats.strength,
    agility: stats.agility,
    intelligence: stats.intelligence,
    armor: stats.armor,
    skills: [],
  };
}

function firstEnemy(runtime: CombatRuntime, actorId: string): string {
  const current = runtime.actors.find((candidate) => candidate.actorId === actorId);
  const target = runtime.actors.find((candidate) =>
    candidate.teamId !== current?.teamId && candidate.hp > 0 && !candidate.withdrawn);
  if (!target) throw new Error('Simulation has no valid enemy target.');
  return target.actorId;
}

export function simulateProgressionCase(input: ProgressionSimulationCase): ProgressionSimulationResult {
  if (!Number.isInteger(input.level) || input.level < 1 || input.level > 100) throw new Error('level must be 1-100.');
  if (!Number.isInteger(input.teamSize) || input.teamSize < 1 || input.teamSize > 10) throw new Error('teamSize must be 1-10.');
  if (!Number.isInteger(input.runs) || input.runs < 1 || input.runs > 100_000) throw new Error('runs must be 1-100000.');
  if (!Number.isInteger(input.maximumActions) || input.maximumActions < 1) throw new Error('maximumActions must be positive.');
  let attackerWins = 0;
  let defenderWins = 0;
  let timeouts = 0;
  let totalActions = 0;
  let minimumActions = Number.POSITIVE_INFINITY;
  let maximumObservedActions = 0;
  for (let run = 0; run < input.runs; run += 1) {
    const random = createDeterministicRandom((input.seed + run * 0x9e3779b9) >>> 0);
    const engine = new CombatEngine(random);
    const attackers = Array.from({ length: input.teamSize }, (_, index) =>
      actor('a', index, input.attackerClass, input.level, input.attackerNode));
    const defenders = Array.from({ length: input.teamSize }, (_, index) =>
      actor('b', index, input.defenderClass, input.level, input.defenderNode));
    const runtime = engine.createRequest(
      `progression:${input.level}:${input.teamSize}:${run}`,
      'PVP',
      'progression-simulation',
      { anchorActorId: attackers[0]!.actorId, actors: attackers },
      { anchorActorId: defenders[0]!.actorId, actors: defenders },
      0,
      30_000,
    );
    engine.start(runtime, 0);
    let actions = 0;
    while (runtime.status === 'ACTIVE' && actions < input.maximumActions) {
      const actorId = runtime.activeActorId;
      if (!actorId) break;
      engine.act(runtime, actorId, {
        action: 'BASIC_ATTACK',
        targetActorId: firstEnemy(runtime, actorId),
      }, (actions + 1) * 1_000);
      actions += 1;
    }
    totalActions += actions;
    minimumActions = Math.min(minimumActions, actions);
    maximumObservedActions = Math.max(maximumObservedActions, actions);
    if (runtime.status === 'ACTIVE') timeouts += 1;
    else if (runtime.winnerTeamId === runtime.teams[0].teamId) attackerWins += 1;
    else if (runtime.winnerTeamId === runtime.teams[1].teamId) defenderWins += 1;
  }
  const averageActions = totalActions / input.runs;
  return {
    ...input,
    attackerWins,
    defenderWins,
    timeouts,
    averageActions,
    minimumActions: Number.isFinite(minimumActions) ? minimumActions : 0,
    maximumObservedActions,
    controlled: timeouts === 0 && averageActions >= input.teamSize * 2 && averageActions <= input.teamSize * 120,
  };
}

export function simulateRepresentativeProgression(input: {
  runs?: number;
  seed?: number;
  levels?: number[];
  teamSizes?: number[];
} = {}): ProgressionSimulationResult[] {
  const levels = input.levels ?? [1, 10, 25, 50, 75, 100];
  const teamSizes = input.teamSizes ?? [1, 3, 5, 10];
  return levels.flatMap((level) => teamSizes.flatMap((teamSize, index) => [
    simulateProgressionCase({
      level,
      teamSize,
      attackerClass: 'WARRIOR',
      attackerNode: 'ENDURANCE',
      defenderClass: 'MAGE',
      defenderNode: 'RITUAL_KNOWLEDGE',
      runs: input.runs ?? 100,
      seed: (input.seed ?? 20260801) + level * 31 + teamSize * 101 + index,
      maximumActions: teamSize * 250,
    }),
    simulateProgressionCase({
      level,
      teamSize,
      attackerClass: 'ARCHER',
      attackerNode: 'PRECISION',
      defenderClass: 'WARRIOR',
      defenderNode: 'CONTROL',
      runs: input.runs ?? 100,
      seed: (input.seed ?? 20260801) + level * 43 + teamSize * 137 + index,
      maximumActions: teamSize * 250,
    }),
  ]));
}
