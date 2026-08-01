import { Logger, Optional } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type {
  CombatSnapshot,
  GameSocket,
  SocketAck,
  SocketErrorPayload,
} from '../../contracts/socket.events.js';
import {
  combatActionSchema,
  combatGetActiveSchema,
  combatLeaveSchema,
  combatRequestSchema,
  combatRespondSchema,
  type CombatActionPayload,
  type CombatLeavePayload,
  type CombatRespondPayload,
} from '../../contracts/socket.schemas.js';
import { deterministicEventId } from '../../foundation/events/deterministic-event-id.js';
import { DomainEventService } from '../../foundation/events/domain-event.service.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { CombatService } from './combat.service.js';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class CombatGateway {
  private readonly logger = new Logger(CombatGateway.name);

  constructor(
    private readonly combats: CombatService,
    private readonly world: WorldStateService,
    private readonly localization: LocalizationService,
    @Optional() private readonly domainEvents?: DomainEventService,
  ) {}

  @SubscribeMessage('combat:getActive')
  getActive(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot | null>> {
    return this.handle(client, combatGetActiveSchema, raw, (session) =>
      this.combats.getActive(session.userId, session.characterId),
    );
  }

  @SubscribeMessage('combat:request')
  request(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot>> {
    return this.handle(client, combatRequestSchema, raw, (session, payload) =>
      this.combats.request(
        session.userId,
        session.characterId,
        payload.targetCharacterId,
      ),
    );
  }

  @SubscribeMessage('combat:respond')
  respond(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot>> {
    return this.handle(
      client,
      combatRespondSchema,
      raw,
      async (session, payload) => {
        const snapshot = await this.combats.respond(
          session.userId,
          session.characterId,
          payload.combatId,
          payload.accept,
        );
        if (payload.accept && snapshot.status === 'ACTIVE') {
          this.emitCombatStarted(session, payload, snapshot);
        }
        return snapshot;
      },
    );
  }

  @SubscribeMessage('combat:act')
  act(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot>> {
    return this.handle(
      client,
      combatActionSchema,
      raw,
      async (session, payload) => {
        const snapshot = await this.combats.act(
          session.userId,
          session.characterId,
          payload.combatId,
          payload,
        );
        this.emitCombatAction(session, payload, snapshot);
        if (snapshot.finishedAt) {
          this.emitCombatFinished(
            session,
            snapshot,
            `combat-finished:${payload.requestId}`,
          );
        }
        return snapshot;
      },
    );
  }

  @SubscribeMessage('combat:leave')
  leave(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot>> {
    return this.handle(
      client,
      combatLeaveSchema,
      raw,
      async (session, payload) => {
        const snapshot = await this.combats.leave(
          session.userId,
          session.characterId,
          payload.combatId,
        );
        if (snapshot.finishedAt) {
          this.emitCombatFinished(
            session,
            snapshot,
            `combat-finished:${payload.requestId}`,
          );
        }
        return snapshot;
      },
    );
  }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (
      session: PlayerSession,
      payload: TPayload,
    ) => Promise<TResult> | TResult,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.world.getBySocketId(client.id);
      if (
        !session ||
        !session.activeInWorld ||
        client.data.sessionState !== 'IN_WORLD'
      ) {
        throw new GameError(
          GAME_ERROR_CODES.SESSION_NOT_READY,
          'errors.session.notReady',
        );
      }
      return { ok: true, data: await operation(session, payload) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private emitCombatStarted(
    session: PlayerSession,
    payload: CombatRespondPayload,
    snapshot: CombatSnapshot,
  ): void {
    this.emitEvent(
      {
        id: deterministicEventId(`combat.started:${payload.requestId}`),
        eventType: 'combat.started',
        operationId: `combat-started:${payload.requestId}`,
        correlationId: snapshot.combatId,
        payload: {
          combatId: snapshot.combatId,
          zoneType: snapshot.zoneType,
          teamSize: Math.max(1, snapshot.participants.length / 2),
          composition: this.composition(snapshot),
          participantCount: snapshot.participants.length,
          startedAt: snapshot.startedAt,
        },
      },
      session,
      snapshot,
    );
  }

  private emitCombatAction(
    session: PlayerSession,
    payload: CombatActionPayload,
    snapshot: CombatSnapshot,
  ): void {
    const latest = snapshot.recentActions.at(-1);
    if (!latest) return;
    const damage = latest.results.reduce(
      (sum, result) => sum + Math.max(0, -result.hpDelta),
      0,
    );
    const healing = latest.results.reduce(
      (sum, result) => sum + Math.max(0, result.hpDelta),
      0,
    );
    this.emitEvent(
      {
        id: deterministicEventId(`combat.action.accepted:${payload.requestId}`),
        eventType: 'combat.action.accepted',
        operationId: `combat-action:${payload.requestId}`,
        correlationId: snapshot.combatId,
        payload: {
          combatId: snapshot.combatId,
          sequence: latest.sequence,
          turnNumber: snapshot.turnNumber,
          actorId: latest.actorId,
          targetActorId: latest.targetActorId,
          action: latest.action,
          skillKey: latest.skillKey,
          damage,
          healing,
          dodgedTargets: latest.results.filter((result) => result.dodged).length,
          affectedTargets: latest.results.length,
          success: true,
          teamSize: Math.max(1, snapshot.participants.length / 2),
          composition: this.composition(snapshot),
        },
      },
      session,
      snapshot,
    );
  }

  private emitCombatFinished(
    session: PlayerSession,
    snapshot: CombatSnapshot,
    identity: string,
  ): void {
    this.emitEvent(
      {
        id: deterministicEventId(`combat.finished:${identity}`),
        eventType: 'combat.finished',
        operationId: identity,
        correlationId: snapshot.combatId,
        payload: {
          combatId: snapshot.combatId,
          finishReason: snapshot.finishReason,
          winnerActorId: snapshot.winnerActorId,
          won: snapshot.winnerActorId === session.characterId,
          durationMs: Math.max(
            0,
            (snapshot.finishedAt ?? Date.now()) -
              (snapshot.startedAt ?? snapshot.createdAt),
          ),
          turns: snapshot.turnNumber,
          teamSize: Math.max(1, snapshot.participants.length / 2),
          composition: this.composition(snapshot),
          participantCount: snapshot.participants.length,
        },
      },
      session,
      snapshot,
    );
  }

  private emitEvent(
    input: {
      id: string;
      eventType:
        | 'combat.started'
        | 'combat.action.accepted'
        | 'combat.finished';
      operationId: string;
      correlationId: string;
      payload: Record<string, unknown>;
    },
    session: PlayerSession,
    snapshot: CombatSnapshot,
  ): void {
    if (!this.domainEvents) return;
    void this.domainEvents
      .emit({
        ...input,
        eventVersion: 1,
        realmId: session.realmId,
        mapId: snapshot.mapId,
        characterId: session.characterId,
        accountId: session.userId,
        sessionId: session.connectionId,
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Combat telemetry ${input.eventType} failed without blocking gameplay: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }

  private composition(snapshot: CombatSnapshot): string {
    return snapshot.participants
      .map((participant) => participant.characterClass)
      .sort()
      .join('+');
  }

  private toSocketError(
    error: unknown,
    client: GameSocket,
  ): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) {
      return {
        code: error.code,
        message: this.localization.translate(error.messageKey, locale),
        details: error.details,
      };
    }
    if (error instanceof ZodError) {
      return {
        code: GAME_ERROR_CODES.INVALID_PAYLOAD,
        message: this.localization.translate('errors.payload.invalid', locale),
        details: { issues: error.issues },
      };
    }
    this.logger.error(
      'Unhandled combat gateway error.',
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
