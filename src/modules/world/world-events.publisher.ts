import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsTrackingService } from '../../analytics/analytics-tracking.service.js';
import type {
  CombatActionResolutionPayload,
  CombatSnapshot,
  GameNamespace,
  ServerToClientEvents,
} from '../../contracts/socket.events.js';
import type { TacticalCombatAction } from '../../contracts/tactical-combat.events.js';
import { WorldStateService } from './world-state.service.js';

const TACTICAL_ACTIONS = new Set<TacticalCombatAction>([
  'GUARD',
  'INTERCEPT',
  'INTERRUPT',
  'CLEANSE',
  'SWAP',
  'SUPPORT_ENERGY',
  'SKIP',
]);

@Injectable()
export class WorldEventsPublisher {
  private readonly logger = new Logger(WorldEventsPublisher.name);
  private readonly trackedCombatSequence = new Map<string, number>();
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
      this.trackCombatActions(snapshot);
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
      if (!['REQUESTED', 'ACTIVE'].includes(snapshot.status)) {
        const finalSequence = snapshot.lastSequence ?? this.maximumSequence(snapshot.recentActions);
        const cleanup = setTimeout(() => {
          if (this.trackedCombatSequence.get(snapshot.combatId) === finalSequence) {
            this.trackedCombatSequence.delete(snapshot.combatId);
          }
        }, 30_000);
        cleanup.unref?.();
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

  private trackCombatActions(snapshot: CombatSnapshot): void {
    const previous = this.trackedCombatSequence.get(snapshot.combatId) ?? 0;
    const unseen = snapshot.recentActions
      .filter((resolution) => resolution.sequence > previous)
      .sort((left, right) => left.sequence - right.sequence);
    if (unseen.length === 0) return;

    for (const resolution of unseen) {
      const session = this.worldState.getByCharacterId(resolution.actorId);
      const command = this.analyticsCommand(resolution);
      if (session && command) {
        void this.analytics.combatActionAccepted(session, snapshot, command);
      }
    }
    this.trackedCombatSequence.set(
      snapshot.combatId,
      Math.max(previous, this.maximumSequence(unseen)),
    );
  }

  private analyticsCommand(resolution: CombatActionResolutionPayload): {
    action: 'BASIC_ATTACK' | 'SKILL' | TacticalCombatAction;
    skillKey?: string;
    targetActorId?: string;
    telegraphId?: string;
  } | undefined {
    if (resolution.tacticalAction === 'TELEGRAPH_RESOLVED') return undefined;
    const tactical = resolution.tacticalAction;
    if (tactical && TACTICAL_ACTIONS.has(tactical as TacticalCombatAction)) {
      return {
        action: tactical as TacticalCombatAction,
        ...(resolution.targetActorId ? { targetActorId: resolution.targetActorId } : {}),
        ...(resolution.reactionToTelegraphId
          ? { telegraphId: resolution.reactionToTelegraphId }
          : {}),
      };
    }
    if (resolution.action === 'BASIC_ATTACK') {
      return {
        action: 'BASIC_ATTACK',
        ...(resolution.targetActorId ? { targetActorId: resolution.targetActorId } : {}),
      };
    }
    if (resolution.action === 'SKILL' && resolution.skillKey) {
      return {
        action: 'SKILL',
        skillKey: resolution.skillKey,
        ...(resolution.targetActorId ? { targetActorId: resolution.targetActorId } : {}),
      };
    }
    return undefined;
  }

  private maximumSequence(actions: readonly CombatActionResolutionPayload[]): number {
    return actions.reduce((maximum, action) => Math.max(maximum, action.sequence), 0);
  }
}
