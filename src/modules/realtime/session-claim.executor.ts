import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';

@Injectable()
export class SessionClaimExecutor implements OnModuleDestroy {
  private readonly executor = new KeyedSerialExecutor();
  private acceptingClaims = true;

  run<T>(characterId: string, task: () => Promise<T>): Promise<T> {
    if (!this.acceptingClaims) {
      return Promise.reject(
        new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady'),
      );
    }
    return this.executor.run(characterId, task);
  }

  async onModuleDestroy(): Promise<void> {
    this.acceptingClaims = false;
    await this.executor.drain();
  }
}
