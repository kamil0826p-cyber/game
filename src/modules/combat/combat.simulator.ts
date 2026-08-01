import type { CombatSnapshot } from '../../contracts/socket.events.js';
import { CombatEngine } from './combat.engine.js';
import type { CombatTimingPolicy } from './combat.rules.js';
import type {
  CombatActionCommand,
  CombatRuntime,
  CombatTeamInput,
} from './combat.types.js';

export interface CombatSimulationSetup {
  combatId: string;
  zoneType: CombatRuntime['zoneType'];
  mapId: string;
  firstTeam: CombatTeamInput;
  secondTeam: CombatTeamInput;
  startedAt?: number;
  timingPolicy?: CombatTimingPolicy;
}

export interface CombatSimulationStep {
  actorId: string;
  command: CombatActionCommand;
  at?: number;
}

export type CombatSimulationStrategy = (
  snapshot: CombatSnapshot,
  runtime: Readonly<CombatRuntime>,
) => CombatSimulationStep | undefined;

export function createSeededCombatRandom(seed: number): () => number {
  let state = Math.trunc(seed) >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Pure in-memory harness. It deliberately has no NestJS, Socket.IO or Prisma
 * dependency, so the same CombatEngine rules can be used by tests and balancing tools.
 */
export class CombatSimulator {
  readonly engine: CombatEngine;
  readonly runtime: CombatRuntime;
  private clock: number;

  constructor(setup: CombatSimulationSetup, seed = 1) {
    this.engine = new CombatEngine(createSeededCombatRandom(seed));
    this.clock = setup.startedAt ?? 0;
    this.runtime = this.engine.createRequest(
      setup.combatId,
      setup.zoneType,
      setup.mapId,
      setup.firstTeam,
      setup.secondTeam,
      this.clock,
      this.clock,
      setup.timingPolicy,
    );
    this.engine.start(this.runtime, this.clock);
  }

  snapshot(): CombatSnapshot {
    return this.engine.snapshot(this.runtime);
  }

  dispatch(step: CombatSimulationStep): CombatSnapshot {
    this.clock = Math.max(this.clock + 1, step.at ?? this.clock + 1);
    return this.engine.act(
      this.runtime,
      step.actorId,
      {
        ...step.command,
        expectedTurnNumber:
          step.command.expectedTurnNumber ?? this.runtime.turnNumber,
        contractVersion: step.command.contractVersion ?? 2,
      },
      this.clock,
    );
  }

  expireWindow(at?: number): CombatSnapshot {
    this.clock = Math.max(this.clock + 1, at ?? this.runtime.turnEndsAt ?? this.clock + 1);
    if (this.runtime.phase === 'REACTION') {
      return this.engine.resolveTelegraph(this.runtime, this.clock);
    }
    if (!this.runtime.activeActorId) return this.snapshot();
    return this.engine.timeout(this.runtime, this.runtime.activeActorId, this.clock);
  }

  run(strategy: CombatSimulationStrategy, maximumSteps = 10_000): CombatSnapshot {
    for (let stepNumber = 0; stepNumber < maximumSteps; stepNumber += 1) {
      const snapshot = this.snapshot();
      if (snapshot.status !== 'ACTIVE') return snapshot;
      const next = strategy(snapshot, this.runtime);
      if (next) this.dispatch(next);
      else this.expireWindow();
    }
    throw new Error('COMBAT_SIMULATION_STEP_LIMIT');
  }
}
