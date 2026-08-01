import { CombatEngine } from '../../modules/combat/combat.engine.js';
import type {
  CombatActorInput,
  CombatRuntime,
  CombatRuntimeActor,
  CombatRuntimeSkill,
  CombatTeamInput,
} from '../../modules/combat/combat.types.js';
import { COMBAT_TEAM_LIMIT } from '../../modules/combat/combat.rules.js';
import { SKILL_CATALOG } from '../../modules/skills/skill.catalog.js';
import { createSeededRandom } from './seeded-random.js';

export interface SimulatorActorProfile {
  name: string;
  characterClass: 'MAGE' | 'WARRIOR' | 'ARCHER';
  level: number;
  maxHp: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
  outfitKey?: string;
}

export interface BalanceScenario {
  key: string;
  teamA: readonly SimulatorActorProfile[];
  teamB: readonly SimulatorActorProfile[];
  iterations?: number;
  maximumActions?: number;
}

export interface SimulationRunResult {
  seed: string;
  outcome: 'TEAM_A_WIN' | 'TEAM_B_WIN' | 'DRAW' | 'TIMEOUT';
  actions: number;
  turns: number;
  ttkMs: number;
  teamASurvivors: number;
  teamBSurvivors: number;
  actionUsage: Record<string, number>;
  skillDamage: Record<string, number>;
  skillHealing: Record<string, number>;
}

export interface BalanceSimulationReport {
  scenarioKey: string;
  iterations: number;
  teamSizeA: number;
  teamSizeB: number;
  winsA: number;
  winsB: number;
  draws: number;
  timeouts: number;
  winRateA: number;
  winRateB: number;
  medianTtkMs: number;
  p95TtkMs: number;
  averageTeamASurvival: number;
  averageTeamBSurvival: number;
  actionUsage: Record<string, number>;
  skillEfficiency: Record<string, { uses: number; damage: number; healing: number }>;
  runs: SimulationRunResult[];
}

export interface BalanceRegressionThresholds {
  maximumTtkIncreasePercent: number;
  maximumWinRateDeltaPercentagePoints: number;
  maximumTimeoutRateIncreasePercentagePoints: number;
}

export interface BalanceComparison {
  passed: boolean;
  regressions: string[];
  baseline: BalanceSimulationReport;
  candidate: BalanceSimulationReport;
}

const defaultProfile = (
  name: string,
  characterClass: SimulatorActorProfile['characterClass'],
): SimulatorActorProfile => ({
  name,
  characterClass,
  level: 20,
  maxHp: characterClass === 'WARRIOR' ? 420 : 320,
  maxEnergy: 120,
  strength: characterClass === 'WARRIOR' ? 46 : 24,
  agility: characterClass === 'ARCHER' ? 46 : 28,
  intelligence: characterClass === 'MAGE' ? 46 : 22,
  armor: characterClass === 'WARRIOR' ? 36 : 22,
});

export function createDefaultBalanceScenario(teamSize: 1 | 3 | 5 | 10): BalanceScenario {
  const classes = ['WARRIOR', 'MAGE', 'ARCHER'] as const;
  const profiles = (prefix: string): SimulatorActorProfile[] =>
    Array.from({ length: teamSize }, (_, index) =>
      defaultProfile(`${prefix}-${index + 1}`, classes[index % classes.length]!),
    );
  return {
    key: `default-${teamSize}v${teamSize}`,
    teamA: profiles('A'),
    teamB: profiles('B'),
    iterations: 25,
    maximumActions: 5_000,
  };
}

function skillsFor(profile: SimulatorActorProfile): readonly CombatRuntimeSkill[] {
  return SKILL_CATALOG.filter(
    (skill) =>
      skill.characterClass === profile.characterClass && skill.minimumLevel <= profile.level,
  ).map((definition) => ({ definition, cooldownTurnsRemaining: 0 }));
}

function toActor(
  profile: SimulatorActorProfile,
  actorId: string,
): CombatActorInput {
  return {
    actorId,
    kind: 'PLAYER',
    characterId: actorId,
    name: profile.name,
    characterClass: profile.characterClass,
    level: profile.level,
    outfitKey: profile.outfitKey ?? `simulator-${profile.characterClass.toLowerCase()}`,
    hp: profile.maxHp,
    maxHp: profile.maxHp,
    energy: profile.maxEnergy,
    maxEnergy: profile.maxEnergy,
    strength: profile.strength,
    agility: profile.agility,
    intelligence: profile.intelligence,
    armor: profile.armor,
    skills: skillsFor(profile),
  };
}

function teamInput(
  side: 'a' | 'b',
  profiles: readonly SimulatorActorProfile[],
): CombatTeamInput {
  const actors = profiles.map((profile, index) => toActor(profile, `${side}-${index + 1}`));
  return { anchorActorId: actors[0]!.actorId, actors };
}

function assertScenario(scenario: BalanceScenario): void {
  for (const [label, team] of [
    ['teamA', scenario.teamA],
    ['teamB', scenario.teamB],
  ] as const) {
    if (team.length < 1 || team.length > COMBAT_TEAM_LIMIT) {
      throw new Error(`${label} must contain 1-${COMBAT_TEAM_LIMIT} actors.`);
    }
    for (const actor of team) {
      if (!Number.isInteger(actor.level) || actor.level < 1) throw new Error(`${actor.name} has invalid level.`);
      for (const stat of [
        actor.maxHp,
        actor.maxEnergy,
        actor.strength,
        actor.agility,
        actor.intelligence,
        actor.armor,
      ]) {
        if (!Number.isFinite(stat) || stat < 0) throw new Error(`${actor.name} has invalid stats.`);
      }
    }
  }
}

function livingEnemies(runtime: CombatRuntime, actor: CombatRuntimeActor): CombatRuntimeActor[] {
  return runtime.actors.filter(
    (candidate) => candidate.teamId !== actor.teamId && candidate.hp > 0 && !candidate.withdrawn,
  );
}

function chooseCommand(
  runtime: CombatRuntime,
  actor: CombatRuntimeActor,
  random: () => number,
): { action: 'BASIC_ATTACK' | 'SKILL'; skillKey?: string; targetActorId?: string } {
  const enemies = livingEnemies(runtime, actor);
  const target = [...enemies].sort(
    (left, right) => left.hp / left.maxHp - right.hp / right.maxHp || left.actorId.localeCompare(right.actorId),
  )[0];
  const skills = [...actor.skills.values()]
    .filter(
      (skill) =>
        skill.cooldownTurnsRemaining === 0 && actor.energy >= skill.definition.energyCost,
    )
    .sort((left, right) => left.definition.key.localeCompare(right.definition.key));
  const useSkill = skills.length > 0 && random() < 0.7;
  if (!useSkill) return { action: 'BASIC_ATTACK', targetActorId: target?.actorId };
  const selected = skills[Math.floor(random() * skills.length)]!;
  return {
    action: 'SKILL',
    skillKey: selected.definition.key,
    ...(selected.definition.targeting === 'SELF' ? {} : { targetActorId: target?.actorId }),
  };
}

function countLiving(runtime: CombatRuntime, teamId: string): number {
  return runtime.actors.filter(
    (actor) => actor.teamId === teamId && actor.hp > 0 && !actor.withdrawn,
  ).length;
}

function sumRecord(target: Record<string, number>, source: Record<string, number>): void {
  for (const [key, value] of Object.entries(source)) target[key] = (target[key] ?? 0) + value;
}

function runScenarioOnce(
  scenario: BalanceScenario,
  seed: string,
): SimulationRunResult {
  const random = createSeededRandom(seed);
  const engine = new CombatEngine(random);
  const runtime = engine.createRequest(
    `simulation:${scenario.key}:${seed}`,
    'PVP',
    'simulation-map',
    teamInput('a', scenario.teamA),
    teamInput('b', scenario.teamB),
    0,
    60_000,
  );
  engine.start(runtime, 0);

  const maximumActions = scenario.maximumActions ?? 5_000;
  const actionUsage: Record<string, number> = {};
  const skillDamage: Record<string, number> = {};
  const skillHealing: Record<string, number> = {};
  let actions = 0;
  let now = 1_000;
  while (runtime.status === 'ACTIVE' && actions < maximumActions) {
    const actor = runtime.actors.find((candidate) => candidate.actorId === runtime.activeActorId);
    if (!actor) break;
    const command = chooseCommand(runtime, actor, random);
    const beforeSequence = runtime.nextSequence;
    engine.act(runtime, actor.actorId, command, now);
    const action = runtime.events.find((event) => event.sequence === beforeSequence);
    const actionKey = command.action === 'SKILL' ? command.skillKey ?? 'unknown-skill' : 'basic-attack';
    actionUsage[actionKey] = (actionUsage[actionKey] ?? 0) + 1;
    for (const result of action?.results ?? []) {
      if (result.hpDelta < 0) skillDamage[actionKey] = (skillDamage[actionKey] ?? 0) - result.hpDelta;
      if (result.hpDelta > 0) skillHealing[actionKey] = (skillHealing[actionKey] ?? 0) + result.hpDelta;
    }
    actions += 1;
    now += 1_000;
  }

  const teamAId = runtime.teams[0].teamId;
  const teamBId = runtime.teams[1].teamId;
  const outcome =
    runtime.status === 'ACTIVE'
      ? 'TIMEOUT'
      : runtime.winnerTeamId === teamAId
        ? 'TEAM_A_WIN'
        : runtime.winnerTeamId === teamBId
          ? 'TEAM_B_WIN'
          : 'DRAW';
  return {
    seed,
    outcome,
    actions,
    turns: runtime.turnNumber,
    ttkMs: actions * 1_000,
    teamASurvivors: countLiving(runtime, teamAId),
    teamBSurvivors: countLiving(runtime, teamBId),
    actionUsage,
    skillDamage,
    skillHealing,
  };
}

const percentile = (values: readonly number[], fraction: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]!;
};

export function simulateBalance(
  scenario: BalanceScenario,
  seed: string | number,
): BalanceSimulationReport {
  assertScenario(scenario);
  const iterations = scenario.iterations ?? 25;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000) {
    throw new Error('Simulation iterations must be between 1 and 10000.');
  }
  const runs = Array.from({ length: iterations }, (_, index) =>
    runScenarioOnce(scenario, `${seed}:${index}`),
  );
  const winsA = runs.filter((run) => run.outcome === 'TEAM_A_WIN').length;
  const winsB = runs.filter((run) => run.outcome === 'TEAM_B_WIN').length;
  const draws = runs.filter((run) => run.outcome === 'DRAW').length;
  const timeouts = runs.filter((run) => run.outcome === 'TIMEOUT').length;
  const actionUsage: Record<string, number> = {};
  const damage: Record<string, number> = {};
  const healing: Record<string, number> = {};
  for (const run of runs) {
    sumRecord(actionUsage, run.actionUsage);
    sumRecord(damage, run.skillDamage);
    sumRecord(healing, run.skillHealing);
  }
  const skillEfficiency = Object.fromEntries(
    Object.keys(actionUsage)
      .sort()
      .map((key) => [
        key,
        { uses: actionUsage[key]!, damage: damage[key] ?? 0, healing: healing[key] ?? 0 },
      ]),
  );
  return {
    scenarioKey: scenario.key,
    iterations,
    teamSizeA: scenario.teamA.length,
    teamSizeB: scenario.teamB.length,
    winsA,
    winsB,
    draws,
    timeouts,
    winRateA: winsA / iterations,
    winRateB: winsB / iterations,
    medianTtkMs: percentile(runs.map((run) => run.ttkMs), 0.5),
    p95TtkMs: percentile(runs.map((run) => run.ttkMs), 0.95),
    averageTeamASurvival:
      runs.reduce((sum, run) => sum + run.teamASurvivors / scenario.teamA.length, 0) / iterations,
    averageTeamBSurvival:
      runs.reduce((sum, run) => sum + run.teamBSurvivors / scenario.teamB.length, 0) / iterations,
    actionUsage,
    skillEfficiency,
    runs,
  };
}

export function compareBalanceReports(
  baseline: BalanceSimulationReport,
  candidate: BalanceSimulationReport,
  thresholds: BalanceRegressionThresholds,
): BalanceComparison {
  const regressions: string[] = [];
  const ttkIncrease = baseline.medianTtkMs === 0
    ? 0
    : ((candidate.medianTtkMs - baseline.medianTtkMs) / baseline.medianTtkMs) * 100;
  const winRateDelta = Math.abs(candidate.winRateA - baseline.winRateA) * 100;
  const timeoutDelta =
    (candidate.timeouts / candidate.iterations - baseline.timeouts / baseline.iterations) * 100;
  if (ttkIncrease > thresholds.maximumTtkIncreasePercent) {
    regressions.push(
      `Median TTK increased by ${ttkIncrease.toFixed(2)}%, threshold ${thresholds.maximumTtkIncreasePercent}%.`,
    );
  }
  if (winRateDelta > thresholds.maximumWinRateDeltaPercentagePoints) {
    regressions.push(
      `Team A win rate changed by ${winRateDelta.toFixed(2)} pp, threshold ${thresholds.maximumWinRateDeltaPercentagePoints} pp.`,
    );
  }
  if (timeoutDelta > thresholds.maximumTimeoutRateIncreasePercentagePoints) {
    regressions.push(
      `Timeout rate increased by ${timeoutDelta.toFixed(2)} pp, threshold ${thresholds.maximumTimeoutRateIncreasePercentagePoints} pp.`,
    );
  }
  return { passed: regressions.length === 0, regressions, baseline, candidate };
}
