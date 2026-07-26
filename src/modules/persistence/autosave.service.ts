import {
  BeforeApplicationShutdown,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { GameConfigService } from '../../config/game-config.service.js';
import { WorldStateService } from '../world/world-state.service.js';
import { PlayerPersistenceService, type PersistenceReason } from './player-persistence.service.js';

@Injectable()
export class AutosaveService
  implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown
{
  private readonly logger = new Logger(AutosaveService.name);
  private timer?: NodeJS.Timeout;
  private flushInProgress?: Promise<void>;

  constructor(
    private readonly config: GameConfigService,
    private readonly worldState: WorldStateService,
    private readonly persistence: PlayerPersistenceService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.flushDirty('autosave').catch((error: unknown) => {
        this.logger.error(
          'Autosave cycle failed.',
          error instanceof Error ? error.stack : undefined,
        );
      });
    }, this.config.values.AUTOSAVE_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.onModuleDestroy();
    await this.flushAll('shutdown');
    await this.persistence.drain();
  }

  async flushDirty(reason: PersistenceReason): Promise<void> {
    if (this.flushInProgress) {
      return this.flushInProgress;
    }
    this.flushInProgress = (async () => {
      await this.flush(
        this.worldState.listSessions().filter((session) => session.dirty),
        reason,
      );
      await this.persistence.flushDetachedSnapshots();
    })().finally(() => {
      this.flushInProgress = undefined;
    });
    return this.flushInProgress;
  }

  async flushAll(reason: PersistenceReason): Promise<void> {
    if (this.flushInProgress) {
      await this.flushInProgress;
    }
    await this.flush(this.worldState.listSessions(), reason);
    await this.persistence.flushDetachedSnapshots();
  }

  private async flush(
    sessions: ReturnType<WorldStateService['listSessions']>,
    reason: PersistenceReason,
  ): Promise<void> {
    if (sessions.length === 0) {
      return;
    }

    const concurrency = this.config.values.AUTOSAVE_CONCURRENCY;
    let cursor = 0;
    const workers = Array.from(
      { length: Math.min(concurrency, sessions.length) },
      async () => {
        while (cursor < sessions.length) {
          const index = cursor;
          cursor += 1;
          const session = sessions[index]!;
          const snapshot = this.persistence.capture(session);
          try {
            await this.persistence.persistSnapshot(snapshot, reason);
            this.worldState.markPersisted(
              snapshot.characterId,
              snapshot.connectionId,
              snapshot.revision,
            );
          } catch (error) {
            this.logger.error(
              `Failed to persist character ${snapshot.characterId} during ${reason}.`,
              error instanceof Error ? error.stack : undefined,
            );
            if (reason === 'shutdown') {
              try {
                await this.persistence.queueDetachedSnapshot(snapshot);
              } catch (retryError) {
                this.logger.error(
                  `Shutdown snapshot remains queued for character ${snapshot.characterId}.`,
                  retryError instanceof Error ? retryError.stack : undefined,
                );
              }
            }
          }
        }
      },
    );
    await Promise.all(workers);
  }
}
