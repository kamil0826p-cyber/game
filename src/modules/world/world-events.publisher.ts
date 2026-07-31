import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsTrackingService } from '../../analytics/analytics-tracking.service.js';
import type {
  CombatSnapshot,
  GameNamespace,
  ServerToClientEvents,
} from '../../contracts/socket.events.js';
import { WorldStateService } from './world-state.service.js';

@Injectable()
export class WorldEventsPublisher {
  private readonly logger = new Logger(WorldEventsPublisher.name);
  private namespace?: GameNamespace;

  constructor(
    private readonly worldState: WorldStateService,
    private readonly analytics: AnalyticsTrackingService,
  ) {}

  bind(namespace: GameNamespace): void {
    this.namespace = namespace;
  }

  emit<K extends keyof ServerToClientEvents>(
    socketId: string,
    event: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    if (event === 'combat:updated') {
      const snapshot = args[0] as CombatSnapshot;
      const session = this.worldState.getBySocketId(socketId);
      if (session) {
        if (snapshot.status === 'ACTIVE' && snapshot.turnNumber === 1) {
          void this.analytics.combatStarted(session, snapshot);
        } else if (
          !['REQUESTED', 'ACTIVE'].includes(snapshot.status) &&
          session.characterId === snapshot.initiatorActorId
        ) {
          void this.analytics.combatResolved(session, snapshot);
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
