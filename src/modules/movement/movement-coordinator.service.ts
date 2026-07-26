import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { Direction } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import type { MovementCommittedPayload, SocketAck } from '../../contracts/socket.events.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { MovementService } from './movement.service.js';
import { PathMovementService } from './path-movement.service.js';

@Injectable()
export class MovementCoordinatorService implements OnModuleDestroy {
  private acceptingCommands = true;

  constructor(
    private readonly movement: MovementService,
    private readonly pathMovement: PathMovementService,
    private readonly serialExecutor: KeyedSerialExecutor,
  ) {}

  requestDirectStep(
    session: PlayerSession,
    direction: Direction,
    requestId: string,
  ): Promise<SocketAck<MovementCommittedPayload>> {
    this.assertAcceptingCommands();
    this.pathMovement.cancel(session.characterId);
    return this.serialExecutor.run(session.characterId, async () => {
      const result = await this.movement.performStep(session, direction, 'DIRECT', requestId);
      return result.accepted
        ? { ok: true, data: result.payload }
        : { ok: false, error: result.error };
    });
  }

  requestPath(
    session: PlayerSession,
    requestId: string,
    targetX: number,
    targetY: number,
  ): Promise<{ requestId: string; pathLength: number }> {
    this.assertAcceptingCommands();
    return this.serialExecutor.run(session.characterId, () =>
      this.pathMovement.startPath(session, requestId, targetX, targetY),
    );
  }

  stopPath(session: PlayerSession): boolean {
    this.assertAcceptingCommands();
    return this.pathMovement.cancel(session.characterId);
  }

  assertAcceptingCommands(): void {
    if (!this.acceptingCommands) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
  }

  runSerialized<T>(session: PlayerSession, task: () => Promise<T> | T): Promise<T> {
    this.assertAcceptingCommands();
    return this.serialExecutor.run(session.characterId, async () => task());
  }

  quiesce<T>(session: PlayerSession, task: () => Promise<T> | T): Promise<T> {
    this.pathMovement.cancel(session.characterId);
    return this.serialExecutor.run(session.characterId, async () => task());
  }

  async onModuleDestroy(): Promise<void> {
    this.acceptingCommands = false;
    this.pathMovement.cancelAll();
    await this.serialExecutor.drain();
  }
}
