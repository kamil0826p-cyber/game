import { Injectable, Logger } from '@nestjs/common';
import type { ServerToClientEvents, GameNamespace } from '../../contracts/socket.events.js';

type LocalEventObserver = (
  socketId: string,
  ...args: unknown[]
) => void | Promise<void>;

@Injectable()
export class WorldEventsPublisher {
  private readonly logger = new Logger(WorldEventsPublisher.name);
  private readonly observers = new Map<keyof ServerToClientEvents, Set<LocalEventObserver>>();
  private namespace?: GameNamespace;

  bind(namespace: GameNamespace): void {
    this.namespace = namespace;
  }

  observe<K extends keyof ServerToClientEvents>(
    event: K,
    observer: (
      socketId: string,
      ...args: Parameters<ServerToClientEvents[K]>
    ) => void | Promise<void>,
  ): () => void {
    const observers = this.observers.get(event) ?? new Set<LocalEventObserver>();
    this.observers.set(event, observers);
    const localObserver = observer as unknown as LocalEventObserver;
    observers.add(localObserver);
    return () => {
      observers.delete(localObserver);
      if (observers.size === 0) this.observers.delete(event);
    };
  }

  emit<K extends keyof ServerToClientEvents>(
    socketId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    for (const observer of this.observers.get(event) ?? []) {
      try {
        void Promise.resolve(observer(socketId, ...(args as unknown[]))).catch(
          (error: unknown) => {
            this.logger.error(
              `Local observer for ${String(event)} failed.`,
              error instanceof Error ? error.stack : undefined,
            );
          },
        );
      } catch (error) {
        this.logger.error(
          `Local observer for ${String(event)} failed.`,
          error instanceof Error ? error.stack : undefined,
        );
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
