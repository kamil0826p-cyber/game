import { Injectable, Logger } from '@nestjs/common';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import { GameConfigService } from '../../config/game-config.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { capturePlayerState, type PlayerStateSnapshot } from './player-state-snapshot.js';

export type PersistenceReason =
  'autosave' | 'combat' | 'disconnect' | 'portal' | 'shutdown' | 'repair';

@Injectable()
export class PlayerPersistenceService {
  private readonly logger = new Logger(PlayerPersistenceService.name);
  private readonly detachedSnapshots = new Map<string, PlayerStateSnapshot>();
  private readonly detachedWrites = new Map<string, Promise<void>>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly serialExecutor: KeyedSerialExecutor,
    private readonly config: GameConfigService,
  ) {}

  capture(session: PlayerSession): PlayerStateSnapshot {
    return capturePlayerState(session);
  }

  persistSession(session: PlayerSession, reason: PersistenceReason): Promise<PlayerStateSnapshot> {
    const snapshot = this.capture(session);
    return this.persistSnapshot(snapshot, reason);
  }

  persistSnapshot(
    snapshot: PlayerStateSnapshot,
    reason: PersistenceReason,
  ): Promise<PlayerStateSnapshot> {
    return this.serialExecutor.run(snapshot.characterId, async () => {
      const result = await this.prisma.character.updateMany({
        where: {
          id: snapshot.characterId,
          realmId: snapshot.realmId,
          stateVersion: { lte: snapshot.revision },
        },
        data: {
          mapId: snapshot.mapId,
          x: snapshot.x,
          y: snapshot.y,
          direction: snapshot.direction,
          outfitKey: snapshot.outfitKey,
          combatState: snapshot.combatState,
          hp: snapshot.hp,
          energy: snapshot.energy,
          stateVersion: snapshot.revision,
          lastSavedAt: new Date(),
        },
      });

      if (result.count !== 1) {
        const current = await this.prisma.character.findUnique({
          where: { id: snapshot.characterId },
          select: { realmId: true, stateVersion: true },
        });
        if (current?.realmId === snapshot.realmId && current.stateVersion >= snapshot.revision) {
          this.logger.warn(
            `Skipped stale character snapshot ${snapshot.characterId} at revision ${snapshot.revision}.`,
          );
          return snapshot;
        }
        throw new Error(`Character ${snapshot.characterId} could not be persisted.`);
      }

      this.logger.debug(
        `Persisted character ${snapshot.characterId} at revision ${snapshot.revision} (${reason}).`,
      );
      return snapshot;
    });
  }

  queueDetachedSnapshot(snapshot: PlayerStateSnapshot): Promise<void> {
    const existing = this.detachedSnapshots.get(snapshot.characterId);
    if (
      !existing ||
      snapshot.revision > existing.revision ||
      (snapshot.revision === existing.revision && snapshot.capturedAt >= existing.capturedAt)
    ) {
      this.detachedSnapshots.set(snapshot.characterId, snapshot);
    }
    return this.flushDetachedCharacter(snapshot.characterId);
  }

  flushDetachedCharacter(characterId: string): Promise<void> {
    const existingWrite = this.detachedWrites.get(characterId);
    if (existingWrite) {
      return existingWrite;
    }
    if (!this.detachedSnapshots.has(characterId)) {
      return Promise.resolve();
    }

    const write = this.persistDetachedCharacter(characterId).finally(() => {
      if (this.detachedWrites.get(characterId) === write) {
        this.detachedWrites.delete(characterId);
      }
    });
    this.detachedWrites.set(characterId, write);
    return write;
  }

  async flushDetachedSnapshots(): Promise<void> {
    const characterIds = [...this.detachedSnapshots.keys()];
    if (characterIds.length === 0) {
      return;
    }

    let cursor = 0;
    const workerCount = Math.min(this.config.values.AUTOSAVE_CONCURRENCY, characterIds.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < characterIds.length) {
        const characterId = characterIds[cursor]!;
        cursor += 1;
        try {
          await this.flushDetachedCharacter(characterId);
        } catch (error) {
          this.logger.error(
            `Detached snapshot remains queued for character ${characterId}.`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    });
    await Promise.all(workers);
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.detachedWrites.values()]);
    await this.flushDetachedSnapshots();
    await this.serialExecutor.drain();
  }

  private async persistDetachedCharacter(characterId: string): Promise<void> {
    while (true) {
      const snapshot = this.detachedSnapshots.get(characterId);
      if (!snapshot) {
        return;
      }

      let lastError: unknown;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          await this.persistSnapshot(snapshot, 'disconnect');
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          this.logger.error(
            `Detached persistence attempt ${attempt} failed for ${characterId}.`,
            error instanceof Error ? error.stack : undefined,
          );
          if (attempt < 3) {
            await new Promise((resolve) => setTimeout(resolve, attempt * 100));
          }
        }
      }

      if (lastError) {
        throw lastError;
      }
      if (this.detachedSnapshots.get(characterId) === snapshot) {
        this.detachedSnapshots.delete(characterId);
        return;
      }
    }
  }
}
