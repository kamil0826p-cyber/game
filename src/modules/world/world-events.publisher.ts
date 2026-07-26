import { Injectable, Logger } from '@nestjs/common';
import type { ServerToClientEvents, GameNamespace } from '../../contracts/socket.events.js';

@Injectable()
export class WorldEventsPublisher {
  private readonly logger = new Logger(WorldEventsPublisher.name);
  private namespace?: GameNamespace;

  bind(namespace: GameNamespace): void {
    this.namespace = namespace;
  }

  emit<K extends keyof ServerToClientEvents>(
    socketId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
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
