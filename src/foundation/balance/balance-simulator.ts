import { CombatEngine } from '../../modules/combat/combat.engine.js';
import type {
  CombatActionCommand,
  CombatActorInput,
  CombatRuntime,
  CombatRuntimeActor,
  CombatTeamInput,
} from '../../modules/combat/combat.types.js';
import { skillsForClass } from '../../modules/skills/skill.catalog.js';
import type { SkillCatalogDefinition } from '../../modules/skills/skill.types.js';

export type SimulationClass = 'MAGE' | 'WARRIOR' | 'ARCHER';

export interface BalanceTeamTemplate {
  size: 1 | 3 | 5 | 10;
  characterClass: SimulationClass;
  level: number;
  statMultiplier?: number;
}

export interface BalanceScenario {
  key: string;
  seed: number;
  teamA: BalanceTeamTemplate;
  teamB: BalanceTeamTemplate;
  maxTurns?: number;
}

export interface BalanceSimulationReport {
  scenarioKey: string;
  seed: number;
  winner: 'TEAM_A' | 'TEAM_B' | 'DRAW';
  finishReason: string;
  turns: number;
  ttkTurns: number | null;
  survivors: { teamA: number; teamB: number };
  actionUsage: Record<string, number>;
  skillEfficiency: Record<string, { uses: number; damage: number; healing: number }>;
  timedOut: boolean;
}

export interface BalanceRegression {
  metric: string;
  baseline: number;
  candidate: number;
  deltaRatio: number;
  threshold: number;
}

export interface BalanceComparison {
  passed: boolean;
  regressions: BalanceRegression[];
}

export const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0 || 0x9e37_79b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
};

const primaryStats = (
  characterClass: SimulationClass,
  level: number,
  multiplier: number,
): Pick<CombatActorInput, 'strength' | 'agility' | 'intelligence' | 'armor' | 'maxHp' | 'hp' | 'maxEnergy' | 'energy'> => {
  const basePrimary = Math.round((12 + level * 2.2) * multiplier);
  const secondary = Math.round((7 + level * 0.8) * multiplier);
  const maxHp = Math.round((120 + level * 18) * multiplier);
  const maxEnergy = Math.round((70 + level * 4) * multiplier);
  return {
    strength: characterClass === 'WARRIOR' ? basePrimary : secondary,
    agility: characterClass === 'ARCHER' ? basePrimary : secondary,
    intelligence: characterClass === 'MAGE' ? basePrimary : secondary,
    armor: Math.round((8 + level * 1.4) * multiplier),
    maxHp,
    hp: maxHp,
    maxEnergy,
    energy: maxEnergy,
  };
};

const actor = (
  team: 'a' | 'b',
  index: number,
  template: BalanceTeamTemplate,
): CombatActorInput => {
  const multiplier = template.statMultiplier ?? 1;
  return {
    actorId: `${team}-${index + 1}`,
    kind: 'PLAYER',
    characterId: `${team}-character-${index + 1}`,
    name: `${team.toUpperCase()} ${index + 1}`,
    characterClass: template.characterClass,
    level: template.level,
    outfitKey: 'simulation',
    ...primaryStats(template.characterClass, template.level, multiplier),
    skills: skillsForClass(template.characterClass)
      .filter((skill) => skill.minimumLevel <= template.level)
      .map((definition) => ({ definition, cooldownTurnsRemaining: 0 })),
  };
};

const team = (id: 'a' | 'b', template: BalanceTeamTemplate): CombatTeamInput => {
  const actors = Array.from({ length: template.size }, (_, index) => actor(id, index, template));
  return { anchorActorId: actors[0]!.actorId, actors };
};

const damageSkill = (actor: CombatRuntimeActor): SkillCatalogDefinition | undefined =>
  [...actor.skills.values()]
    .filter(
      ({ definition, cooldownTurnsRemaining }) =>
        cooldownTurnsRemaining === 0 &&
        actor.energy >= definition.energyCost &&
        definition.effects.some((effect) => effect.type === 'DAMAGE'),
    )
    .sort((left, right) => right.definition.energyCost - left.definition.energyCost)[0]?.definition;

const commandFor = (runtime: CombatRuntime, actor: CombatRuntimeActor): CombatActionCommand => {
  const enemies = runtime.actors.filter(
    (candidate) => candidate.teamId !== actor.teamId && candidate.hp > 0 && !candidate.withdrawn,
  );
  const target = enemies.sort(
    (left, right) => left.hp / left.maxHp - right.hp / right.maxHp || left.actorId.localeCompare(right.actorId),
  )[0];
  const skill = damageSkill(actor);
  if (!skill) return { action: 'BASIC_ATTACK', targetActorId: target?.actorId };
  return {
    action: 'SKILL',
    skillKey: skill.key,
    targetActorId: skill.targeting === 'SELF' ? actor.actorId : target?.actorId,
  };
};

const living = (runtime: CombatRuntime, teamId: string): number =>
  runtime.actors.filter((candidate) => candidate.teamId === teamId && candidate.hp > 0 && !candidate.withdrawn).length;

export function runBalanceScenario(scenario: BalanceScenario): BalanceSimulationReport {
  const random = seededRandom(scenario.seed);
  const engine = new CombatEngine(random);
  const runtime = engine.createRequest(
    `simulation:${scenario.key}:${scenario.seed}`,
    'OUTLAW',
    'simulation-map',
    team('a', scenario.teamA),
    team('b', scenario.teamB),
    0,
    30_000,
  );
  engine.start(runtime, 0);
  const actionUsage: Record<string, number> = {};
  const skillEfficiency: Record<string, { uses: number; damage: number; healing: number }> = {};
  const maxTurns = scenario.maxTurns ?? 2_000;
  let actions = 0;

  while (runtime.status === 'ACTIVE' && actions < maxTurns) {
    const activeActor = runtime.actors.find((candidate) => candidate.actorId === runtime.activeActorId);
    if (!activeActor) throw new Error('Simulation runtime has no active actor.');
    const beforeSequence = runtime.nextSequence;
    const command = commandFor(runtime, activeActor);
    engine.act(runtime, activeActor.actorId, command, actions * 100);
    actions += 1;
    const resolution = runtime.events.find((event) => event.sequence === beforeSequence);
    const key = command.action === 'SKILL' ? command.skillKey ?? 'unknown-skill' : 'basic-attack';
    actionUsage[key] = (actionUsage[key] ?? 0) + 1;
    const efficiency = (skillEfficiency[key] ??= { uses: 0, damage: 0, healing: 0 });
    efficiency.uses += 1;
    for (const result of resolution?.results ?? []) {
      if (result.hpDelta < 0) efficiency.damage += -result.hpDelta;
      if (result.hpDelta > 0) efficiency.healing += result.hpDelta;
    }
  }

  const teamAId = runtime.teams[0].teamId;
  const teamBId = runtime.teams[1].teamId;
  const timedOut = runtime.status === 'ACTIVE';
  const winner = timedOut
    ? 'DRAW'
    : runtime.winnerTeamId === teamAId
      ? 'TEAM_A'
      : runtime.winnerTeamId === teamBId
        ? 'TEAM_B'
        : 'DRAW';

  return {
    scenarioKey: scenario.key,
    seed: scenario.seed,
    winner,
    finishReason: timedOut ? 'TIMEOUT' : runtime.finishReason ?? runtime.status,
    turns: runtime.turnNumber,
    ttkTurns: timedOut ? null : runtime.turnNumber,
    survivors: { teamA: living(runtime, teamAId), teamB: living(runtime, teamBId) },
    actionUsage,
    skillEfficiency,
    timedOut,
  };
}

export function compareBalanceReports(
  baseline: BalanceSimulationReport,
  candidate: BalanceSimulationReport,
  thresholds: { ttkRatio?: number; survivorDelta?: number } = {},
): BalanceComparison {
  const regressions: BalanceRegression[] = [];
  const ttkThreshold = thresholds.ttkRatio ?? 0.2;
  if (baseline.ttkTurns !== null && candidate.ttkTurns !== null && baseline.ttkTurns > 0) {
    const deltaRatio = Math.abs(candidate.ttkTurns - baseline.ttkTurns) / baseline.ttkTurns;
    if (deltaRatio > ttkThreshold) {
      regressions.push({ metric: 'ttkTurns', baseline: baseline.ttkTurns, candidate: candidate.ttkTurns, deltaRatio, threshold: ttkThreshold });
    }
  }
  const survivorThreshold = thresholds.survivorDelta ?? 2;
  const baselineSurvivors = baseline.survivors.teamA - baseline.survivors.teamB;
  const candidateSurvivors = candidate.survivors.teamA - candidate.survivors.teamB;
  const survivorDelta = Math.abs(candidateSurvivors - baselineSurvivors);
  if (survivorDelta > survivorThreshold) {
    regressions.push({ metric: 'survivorDelta', baseline: baselineSurvivors, candidate: candidateSurvivors, deltaRatio: survivorDelta, threshold: survivorThreshold });
  }
  return { passed: regressions.length === 0, regressions };
}

export const DEFAULT_BALANCE_SCENARIOS: readonly BalanceScenario[] = [
  { key: 'solo-mirror', seed: 101, teamA: { size: 1, characterClass: 'WARRIOR', level: 30 }, teamB: { size: 1, characterClass: 'WARRIOR', level: 30 } },
  { key: 'three-v-three', seed: 303, teamA: { size: 3, characterClass: 'MAGE', level: 40 }, teamB: { size: 3, characterClass: 'ARCHER', level: 40 } },
  { key: 'five-v-five', seed: 505, teamA: { size: 5, characterClass: 'WARRIOR', level: 50 }, teamB: { size: 5, characterClass: 'MAGE', level: 50 } },
  { key: 'ten-v-ten', seed: 1_010, teamA: { size: 10, characterClass: 'ARCHER', level: 60 }, teamB: { size: 10, characterClass: 'WARRIOR', level: 60 } },
];
