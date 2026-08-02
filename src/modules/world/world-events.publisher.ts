import { Injectable, Logger } from '@nestjs/common';
import type {
  CombatSnapshot,
  ServerToClientEvents,
  GameNamespace,
} from '../../contracts/socket.events.js';

type CombatUpdatedListener = (snapshot: CombatSnapshot) => void;

@Injectable()
export class WorldEventsPublisher {
  private readonly logger = new Logger(WorldEventsPublisher.name);
  private readonly combatUpdatedListeners = new Set<CombatUpdatedListener>();
  private namespace?: GameNamespace;

  bind(namespace: GameNamespace): void {
    this.namespace = namespace;
  }

  onCombatUpdated(listener: CombatUpdatedListener): () => void {
    this.combatUpdatedListeners.add(listener);
    return () => this.combatUpdatedListeners.delete(listener);
  }

  emit<K extends keyof ServerToClientEvents>(
    socketId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    if (event === 'combat:updated') {
      const snapshot = args[0] as CombatSnapshot;
      for (const listener of this.combatUpdatedListeners) {
        try {
          listener(snapshot);
        } catch (error) {
          this.logger.error(
            `Combat update listener failed for ${snapshot.combatId}.`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    }
    if (!this.namespace) {
      this.logger.warn(`Dropped ${String(event)} because the game namespace is not ready.`);
      return;
    }
    this.namespace.to(socketId).emit(event, ...args);
  }

  disconnect(socketId: string): void {
    this.namespace?.in(socketId).disconnectSockets(true);
  }
}
