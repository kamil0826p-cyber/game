import { CombatEngine } from '../modules/combat/combat.engine.js';
import type { CombatActionCommand, CombatActorInput, CombatRuntime } from '../modules/combat/combat.types.js';
import { SKILL_CATALOG } from '../modules/skills/skill.catalog.js';

export interface SimulationFighterProfile {
  key: string;
  characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  level: number;
  hp: number;
  energy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
  skillKeys?: string[];
}

export interface SimulationSideProfile {
  fighter: SimulationFighterProfile;
  size: number;
}

export interface SimulationScenario {
  key: string;
  runs: number;
  seed: number;
  maximumTurns: number;
  teamA: SimulationSideProfile;
  teamB: SimulationSideProfile;
}

export interface SimulationMetrics {
  runs: number;
  teamAWins: number;
  teamBWins: number;
  draws: number;
  timeoutRate: number;
  averageTurns: number;
  averageDurationMs: number;
  actionCounts: Record<string, number>;
  skillUsage: Record<string, number>;
}

export interface SimulationComparison {
  baseline: SimulationMetrics;
  candidate: SimulationMetrics;
  delta: {
    teamAWinRate: number;
    timeoutRate: number;
    averageTurns: number;
    averageDurationMs: number;
  };
}

function assertScenario(scenario: SimulationScenario): void {
  if (!scenario.key.trim()) throw new Error('Simulation scenario key is required.');
  if (!Number.isInteger(scenario.runs) || scenario.runs < 1 || scenario.runs > 100_000) throw new Error('Simulation runs must be an integer between 1 and 100000.');
  if (!Number.isInteger(scenario.maximumTurns) || scenario.maximumTurns < 1 || scenario.maximumTurns > 10_000) throw new Error('Simulation maximumTurns must be an integer between 1 and 10000.');
  for (const [sideName, side] of [['teamA', scenario.teamA], ['teamB', scenario.teamB]] as const) {
    if (!Number.isInteger(side.size) || side.size < 1 || side.size > 10) throw new Error(`${sideName}.size must be between 1 and 10.`);
    const fighter = side.fighter;
    for (const field of ['level', 'hp', 'energy', 'strength', 'agility', 'intelligence', 'armor'] as const) {
      if (!Number.isFinite(fighter[field]) || fighter[field] < 0) throw new Error(`${sideName}.fighter.${field} is invalid.`);
    }
    if (fighter.level < 1 || fighter.hp < 1) throw new Error(`${sideName} requires positive level and hp.`);
  }
}

export function createDeterministicRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296;
  };
}

function actor(profile: SimulationFighterProfile, side: string, index: number): CombatActorInput {
  const skills = SKILL_CATALOG
    .filter((definition) =>
      definition.characterClass === profile.characterClass &&
      definition.minimumLevel <= profile.level &&
      (!profile.skillKeys || profile.skillKeys.includes(definition.key)))
    .map((definition) => ({ definition, cooldownTurnsRemaining: 0 }));
  return {
    actorId: `${side}-${index}`,
    kind: 'PLAYER',
    characterId: `${side}-character-${index}`,
    name: `${profile.key}-${index}`,
    characterClass: profile.characterClass,
    level: profile.level,
    outfitKey: `simulation-${profile.characterClass.toLowerCase()}`,
    hp: profile.hp,
    maxHp: profile.hp,
    energy: profile.energy,
    maxEnergy: profile.energy,
    strength: profile.strength,
    agility: profile.agility,
    intelligence: profile.intelligence,
    armor: profile.armor,
    skills,
  };
}

function chooseAction(runtime: CombatRuntime, random: () => number): CombatActionCommand {
  const current = runtime.actors.find((candidate) => candidate.actorId === runtime.activeActorId);
  if (!current) throw new Error('Simulation runtime has no active actor.');
  const enemies = runtime.actors.filter((candidate) => candidate.teamId !== current.teamId && candidate.hp > 0 && !candidate.withdrawn);
  if (enemies.length === 0) throw new Error('Simulation runtime has no living target.');
  const target = enemies[Math.floor(random() * enemies.length)]!;
  const availableSkills = [...current.skills.values()].filter((skill) =>
    skill.cooldownTurnsRemaining === 0 && current.energy >= skill.definition.energyCost);
  if (availableSkills.length > 0 && random() < 0.7) {
    const selected = availableSkills[Math.floor(random() * availableSkills.length)]!;
    return {
      action: 'SKILL',
      skillKey: selected.definition.key,
      ...(selected.definition.targeting === 'SELF' ? {} : { targetActorId: target.actorId }),
    };
  }
  return { action: 'BASIC_ATTACK', targetActorId: target.actorId };
}

export function runBalanceSimulation(scenario: SimulationScenario): SimulationMetrics {
  assertScenario(scenario);
  let teamAWins = 0;
  let teamBWins = 0;
  let draws = 0;
  let timeouts = 0;
  let totalTurns = 0;
  let totalDurationMs = 0;
  const actionCounts: Record<string, number> = {};
  const skillUsage: Record<string, number> = {};

  for (let runIndex = 0; runIndex < scenario.runs; runIndex += 1) {
    const random = createDeterministicRandom((scenario.seed + runIndex * 0x9e3779b9) >>> 0);
    const engine = new CombatEngine(random);
    const runtime = engine.createRequest(
      `${scenario.key}:${runIndex}`,
      'PVP',
      'simulation-map',
      { anchorActorId: 'a-0', actors: Array.from({ length: scenario.teamA.size }, (_, index) => actor(scenario.teamA.fighter, 'a', index)) },
      { anchorActorId: 'b-0', actors: Array.from({ length: scenario.teamB.size }, (_, index) => actor(scenario.teamB.fighter, 'b', index)) },
      0,
      30_000,
    );
    engine.start(runtime, 0);
    let actionIndex = 0;
    while (runtime.status === 'ACTIVE' && actionIndex < scenario.maximumTurns) {
      const command = chooseAction(runtime, random);
      engine.act(runtime, runtime.activeActorId!, command, actionIndex * 1_000 + 1_000);
      actionCounts[command.action] = (actionCounts[command.action] ?? 0) + 1;
      if (command.skillKey) skillUsage[command.skillKey] = (skillUsage[command.skillKey] ?? 0) + 1;
      actionIndex += 1;
    }

    totalTurns += runtime.turnNumber;
    totalDurationMs += actionIndex * 1_000;
    if (runtime.status === 'ACTIVE') {
      timeouts += 1;
      draws += 1;
    } else if (runtime.winnerTeamId === runtime.teams[0].teamId) {
      teamAWins += 1;
    } else if (runtime.winnerTeamId === runtime.teams[1].teamId) {
      teamBWins += 1;
    } else {
      draws += 1;
    }
  }

  return {
    runs: scenario.runs,
    teamAWins,
    teamBWins,
    draws,
    timeoutRate: timeouts / scenario.runs,
    averageTurns: totalTurns / scenario.runs,
    averageDurationMs: totalDurationMs / scenario.runs,
    actionCounts,
    skillUsage,
  };
}

export function compareBalanceSimulations(baseline: SimulationScenario, candidate: SimulationScenario): SimulationComparison {
  const before = runBalanceSimulation(baseline);
  const after = runBalanceSimulation(candidate);
  return {
    baseline: before,
    candidate: after,
    delta: {
      teamAWinRate: after.teamAWins / after.runs - before.teamAWins / before.runs,
      timeoutRate: after.timeoutRate - before.timeoutRate,
      averageTurns: after.averageTurns - before.averageTurns,
      averageDurationMs: after.averageDurationMs - before.averageDurationMs,
    },
  };
}
