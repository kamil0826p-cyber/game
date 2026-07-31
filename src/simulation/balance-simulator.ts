import { CombatEngine } from '../modules/combat/combat.engine.js';
import type {
  CombatActionCommand,
  CombatActorInput,
  CombatRuntime,
} from '../modules/combat/combat.types.js';
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

export interface SimulationRosterEntry {
  fighter: SimulationFighterProfile;
  count: number;
}

export interface SimulationSideProfile {
  members: SimulationRosterEntry[];
}

export interface SimulationScenario {
  key: string;
  runs: number;
  seed: number;
  maximumTurns: number;
  teamA: SimulationSideProfile;
  teamB: SimulationSideProfile;
}

export interface SimulationSuite {
  key: string;
  scenarios: SimulationScenario[];
}

export interface SimulationSkillPerformance {
  uses: number;
  totalDamage: number;
  totalHealing: number;
  totalShield: number;
  dodges: number;
  statusApplications: number;
}

export interface SimulationMetrics {
  runs: number;
  teamASize: number;
  teamBSize: number;
  teamAComposition: Record<string, number>;
  teamBComposition: Record<string, number>;
  teamAWins: number;
  teamBWins: number;
  draws: number;
  timeoutRate: number;
  averageTurns: number;
  averageDurationMs: number;
  actionCounts: Record<string, number>;
  skillUsage: Record<string, number>;
  skillPerformance: Record<string, SimulationSkillPerformance>;
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

export interface SimulationSuiteReport {
  key: string;
  scenarios: Array<{ scenarioKey: string; metrics: SimulationMetrics }>;
}

export interface SimulationSuiteComparison {
  key: string;
  scenarios: Array<{ scenarioKey: string; comparison: SimulationComparison }>;
}

function sideSize(side: SimulationSideProfile): number {
  return side.members.reduce((sum, member) => sum + member.count, 0);
}

function composition(side: SimulationSideProfile): Record<string, number> {
  return Object.fromEntries(side.members.map((member) => [member.fighter.key, member.count]));
}

function assertFighter(fighter: SimulationFighterProfile, path: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,95}$/.test(fighter.key)) {
    throw new Error(`${path}.key is invalid.`);
  }
  for (const field of ['level', 'hp', 'energy', 'strength', 'agility', 'intelligence', 'armor'] as const) {
    if (!Number.isFinite(fighter[field]) || fighter[field] < 0) {
      throw new Error(`${path}.${field} is invalid.`);
    }
  }
  if (fighter.level < 1 || fighter.hp < 1) throw new Error(`${path} requires positive level and hp.`);
  if (fighter.skillKeys && new Set(fighter.skillKeys).size !== fighter.skillKeys.length) {
    throw new Error(`${path}.skillKeys contains duplicates.`);
  }
  for (const skillKey of fighter.skillKeys ?? []) {
    const skill = SKILL_CATALOG.find((candidate) => candidate.key === skillKey);
    if (!skill || skill.characterClass !== fighter.characterClass || skill.minimumLevel > fighter.level) {
      throw new Error(`${path} cannot use skill ${skillKey}.`);
    }
  }
}

function assertSide(side: SimulationSideProfile, path: string): void {
  if (!Array.isArray(side.members) || side.members.length < 1 || side.members.length > 10) {
    throw new Error(`${path}.members must contain 1-10 roster entries.`);
  }
  const keys = new Set<string>();
  side.members.forEach((member, index) => {
    if (!Number.isInteger(member.count) || member.count < 1 || member.count > 10) {
      throw new Error(`${path}.members[${index}].count must be between 1 and 10.`);
    }
    assertFighter(member.fighter, `${path}.members[${index}].fighter`);
    if (keys.has(member.fighter.key)) throw new Error(`${path} repeats fighter profile ${member.fighter.key}.`);
    keys.add(member.fighter.key);
  });
  const total = sideSize(side);
  if (total < 1 || total > 10) throw new Error(`${path} total team size must be between 1 and 10.`);
}

function assertScenario(scenario: SimulationScenario): void {
  if (!scenario.key.trim()) throw new Error('Simulation scenario key is required.');
  if (!Number.isInteger(scenario.runs) || scenario.runs < 1 || scenario.runs > 100_000) {
    throw new Error('Simulation runs must be an integer between 1 and 100000.');
  }
  if (!Number.isInteger(scenario.maximumTurns) || scenario.maximumTurns < 1 || scenario.maximumTurns > 10_000) {
    throw new Error('Simulation maximumTurns must be an integer between 1 and 10000.');
  }
  assertSide(scenario.teamA, 'teamA');
  assertSide(scenario.teamB, 'teamB');
}

function assertSuite(suite: SimulationSuite): void {
  if (!suite.key.trim()) throw new Error('Simulation suite key is required.');
  if (!Array.isArray(suite.scenarios) || suite.scenarios.length < 1 || suite.scenarios.length > 100) {
    throw new Error('Simulation suite must contain 1-100 scenarios.');
  }
  const keys = suite.scenarios.map((scenario) => scenario.key);
  if (new Set(keys).size !== keys.length) throw new Error('Simulation scenario keys must be unique inside a suite.');
  suite.scenarios.forEach(assertScenario);
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

function actors(side: SimulationSideProfile, sideKey: string): CombatActorInput[] {
  const result: CombatActorInput[] = [];
  for (const member of side.members) {
    for (let index = 0; index < member.count; index += 1) {
      result.push(actor(member.fighter, sideKey, result.length));
    }
  }
  return result;
}

function chooseAction(runtime: CombatRuntime, random: () => number): CombatActionCommand {
  const current = runtime.actors.find((candidate) => candidate.actorId === runtime.activeActorId);
  if (!current) throw new Error('Simulation runtime has no active actor.');
  const enemies = runtime.actors.filter((candidate) =>
    candidate.teamId !== current.teamId && candidate.hp > 0 && !candidate.withdrawn);
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

function recordSkillPerformance(
  target: Record<string, SimulationSkillPerformance>,
  skillKey: string,
  results: Array<{
    hpDelta: number;
    shieldDelta: number;
    dodged: boolean;
    statusesApplied: unknown[];
  }>,
): void {
  const current = target[skillKey] ?? {
    uses: 0,
    totalDamage: 0,
    totalHealing: 0,
    totalShield: 0,
    dodges: 0,
    statusApplications: 0,
  };
  current.uses += 1;
  for (const result of results) {
    current.totalDamage += Math.max(0, -result.hpDelta);
    current.totalHealing += Math.max(0, result.hpDelta);
    current.totalShield += Math.max(0, result.shieldDelta);
    current.dodges += result.dodged ? 1 : 0;
    current.statusApplications += result.statusesApplied.length;
  }
  target[skillKey] = current;
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
  const skillPerformance: Record<string, SimulationSkillPerformance> = {};

  for (let runIndex = 0; runIndex < scenario.runs; runIndex += 1) {
    const random = createDeterministicRandom((scenario.seed + runIndex * 0x9e3779b9) >>> 0);
    const engine = new CombatEngine(random);
    const teamAActors = actors(scenario.teamA, 'a');
    const teamBActors = actors(scenario.teamB, 'b');
    const runtime = engine.createRequest(
      `${scenario.key}:${runIndex}`,
      'PVP',
      'simulation-map',
      { anchorActorId: teamAActors[0]!.actorId, actors: teamAActors },
      { anchorActorId: teamBActors[0]!.actorId, actors: teamBActors },
      0,
      30_000,
    );
    engine.start(runtime, 0);
    let actionIndex = 0;
    while (runtime.status === 'ACTIVE' && actionIndex < scenario.maximumTurns) {
      const actorId = runtime.activeActorId!;
      const command = chooseAction(runtime, random);
      const snapshot = engine.act(runtime, actorId, command, actionIndex * 1_000 + 1_000);
      actionCounts[command.action] = (actionCounts[command.action] ?? 0) + 1;
      if (command.skillKey) {
        skillUsage[command.skillKey] = (skillUsage[command.skillKey] ?? 0) + 1;
        const resolution = [...snapshot.recentActions].reverse().find((candidate) =>
          candidate.actorId === actorId &&
          candidate.action === 'SKILL' &&
          candidate.skillKey === command.skillKey);
        if (resolution) recordSkillPerformance(skillPerformance, command.skillKey, resolution.results);
      }
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
    teamASize: sideSize(scenario.teamA),
    teamBSize: sideSize(scenario.teamB),
    teamAComposition: composition(scenario.teamA),
    teamBComposition: composition(scenario.teamB),
    teamAWins,
    teamBWins,
    draws,
    timeoutRate: timeouts / scenario.runs,
    averageTurns: totalTurns / scenario.runs,
    averageDurationMs: totalDurationMs / scenario.runs,
    actionCounts,
    skillUsage,
    skillPerformance,
  };
}

export function compareBalanceSimulations(
  baseline: SimulationScenario,
  candidate: SimulationScenario,
): SimulationComparison {
  if (baseline.key !== candidate.key) throw new Error('Compared simulation scenarios must have the same key.');
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

export function runBalanceSuite(suite: SimulationSuite): SimulationSuiteReport {
  assertSuite(suite);
  return {
    key: suite.key,
    scenarios: suite.scenarios.map((scenario) => ({
      scenarioKey: scenario.key,
      metrics: runBalanceSimulation(scenario),
    })),
  };
}

export function compareBalanceSuites(
  baseline: SimulationSuite,
  candidate: SimulationSuite,
): SimulationSuiteComparison {
  assertSuite(baseline);
  assertSuite(candidate);
  const candidateByKey = new Map(candidate.scenarios.map((scenario) => [scenario.key, scenario]));
  if (baseline.scenarios.length !== candidate.scenarios.length ||
      baseline.scenarios.some((scenario) => !candidateByKey.has(scenario.key))) {
    throw new Error('Compared simulation suites must contain the same scenario keys.');
  }
  return {
    key: `${baseline.key}->${candidate.key}`,
    scenarios: baseline.scenarios.map((scenario) => ({
      scenarioKey: scenario.key,
      comparison: compareBalanceSimulations(scenario, candidateByKey.get(scenario.key)!),
    })),
  };
}
