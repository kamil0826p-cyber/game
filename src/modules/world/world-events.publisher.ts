import { Injectable, Logger } from '@nestjs/common';
import type {
  CombatSnapshot,
  GameNamespace,
  ServerToClientEvents,
} from '../../contracts/socket.events.js';

type CombatUpdateListener = (snapshot: CombatSnapshot) => void | Promise<void>;

@Injectable()
export class WorldEventsPublisher {
  private readonly logger = new Logger(WorldEventsPublisher.name);
  private readonly combatUpdateListeners = new Set<CombatUpdateListener>();
  private namespace?: GameNamespace;

  bind(namespace: GameNamespace): void {
    this.namespace = namespace;
  }

  onCombatUpdated(listener: CombatUpdateListener): () => void {
    this.combatUpdateListeners.add(listener);
    return () => this.combatUpdateListeners.delete(listener);
  }

  emit<K extends keyof ServerToClientEvents>(
    socketId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    if (!this.namespace) {
      this.logger.warn(`Dropped ${String(event)} because the game namespace is not ready.`);
    } else {
      this.namespace.to(socketId).emit(event, ...args);
    }

    if (event !== 'combat:updated') return;
    const snapshot = args[0] as CombatSnapshot;
    for (const listener of this.combatUpdateListeners) {
      queueMicrotask(() => {
        void Promise.resolve(listener(snapshot)).catch((error: unknown) => {
          this.logger.error(
            `Combat update listener failed for ${snapshot.combatId}.`,
            error instanceof Error ? error.stack : undefined,
          );
        });
      });
    }
  }

  disconnect(socketId: string): void {
    this.namespace?.in(socketId).disconnectSockets(true);
  }
}
