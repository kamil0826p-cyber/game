import { Injectable, Logger } from '@nestjs/common';
import type { Direction } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES } from '../../common/errors/game.error.js';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import { MapService } from '../maps/map.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { MovementService } from './movement.service.js';
import { PathfindingService } from './pathfinding.service.js';

interface PathJob {
  requestId: string;
  characterId: string;
  connectionId: string;
  sourceMapId: string;
  path: Direction[];
  index: number;
  timer?: NodeJS.Timeout;
}

@Injectable()
export class PathMovementService {
  private readonly logger = new Logger(PathMovementService.name);
  private readonly jobs = new Map<string, PathJob>();

  constructor(
    private readonly maps: MapService,
    private readonly worldState: WorldStateService,
    private readonly pathfinding: PathfindingService,
    private readonly movement: MovementService,
    private readonly serialExecutor: KeyedSerialExecutor,
  ) {}

  async startPath(
    session: PlayerSession,
    requestId: string,
    targetX: number,
    targetY: number,
  ): Promise<{ requestId: string; pathLength: number }> {
    this.cancel(session.characterId);
    const map = await this.maps.getMap(session.mapId);
    const path = this.pathfinding.findPath(
      map,
      { x: session.x, y: session.y },
      { x: targetX, y: targetY },
      (x, y) =>
        map.zoneType !== 'SAFE' &&
        this.worldState.isOccupied(map.id, x, y, session.characterId),
    );

    if (path.length === 0) {
      return { requestId, pathLength: 0 };
    }

    const job: PathJob = {
      requestId,
      characterId: session.characterId,
      connectionId: session.connectionId,
      sourceMapId: session.mapId,
      path,
      index: 0,
    };
    this.jobs.set(session.characterId, job);
    this.schedule(job, session);
    return { requestId, pathLength: path.length };
  }

  cancel(characterId: string): boolean {
    const job = this.jobs.get(characterId);
    if (!job) {
      return false;
    }
    if (job.timer) {
      clearTimeout(job.timer);
    }
    this.jobs.delete(characterId);
    return true;
  }

  cancelAll(): void {
    for (const characterId of [...this.jobs.keys()]) {
      this.cancel(characterId);
    }
  }

  private schedule(job: PathJob, session: PlayerSession, additionalDelay = 0): void {
    const delay = Math.max(0, session.nextMoveAllowedAt - Date.now(), additionalDelay);
    job.timer = setTimeout(() => {
      void this.serialExecutor
        .run(job.characterId, async () => {
          await this.executeNext(job);
        })
        .catch((error: unknown) => {
          this.cancel(job.characterId);
          this.logger.error(
            `Path execution failed for character ${job.characterId}.`,
            error instanceof Error ? error.stack : undefined,
          );
        });
    }, delay);
    job.timer.unref();
  }

  private async executeNext(job: PathJob): Promise<void> {
    if (this.jobs.get(job.characterId) !== job) {
      return;
    }
    const session = this.worldState.getByCharacterId(job.characterId);
    if (
      !session ||
      session.connectionId !== job.connectionId ||
      session.mapId !== job.sourceMapId
    ) {
      this.cancel(job.characterId);
      return;
    }

    const direction = job.path[job.index];
    if (!direction) {
      this.cancel(job.characterId);
      return;
    }

    const result = await this.movement.performStep(
      session,
      direction,
      'PATH',
      job.requestId,
    );
    if (!result.accepted) {
      if (result.error.code === GAME_ERROR_CODES.MOVE_TOO_FAST) {
        this.schedule(job, session, result.error.retryAfterMs ?? 1);
      } else {
        this.cancel(job.characterId);
      }
      return;
    }

    if (result.payload.portalTransition) {
      this.cancel(job.characterId);
      return;
    }

    job.index += 1;
    if (job.index >= job.path.length) {
      this.cancel(job.characterId);
      return;
    }
    this.schedule(job, session);
  }
}
