import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { AnalyticsTrackingService } from '../../analytics/analytics-tracking.service.js';
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
} from '../../contracts/socket.schemas.js';
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
    private readonly analytics: AnalyticsTrackingService,
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
    return this.handle(client, combatRequestSchema, raw, async (session, payload) => {
      const snapshot = await this.combats.request(session.userId, session.characterId, payload.targetCharacterId);
      if (snapshot.status === 'ACTIVE') void this.analytics.combatStarted(session, snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage('combat:respond')
  respond(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot>> {
    return this.handle(client, combatRespondSchema, raw, async (session, payload) => {
      const snapshot = await this.combats.respond(session.userId, session.characterId, payload.combatId, payload.accept);
      if (payload.accept && snapshot.status === 'ACTIVE') void this.analytics.combatStarted(session, snapshot);
      else if (!['REQUESTED', 'ACTIVE'].includes(snapshot.status)) void this.analytics.combatResolved(session, snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage('combat:act')
  act(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot>> {
    return this.handle(client, combatActionSchema, raw, async (session, payload) => {
      const snapshot = await this.combats.act(session.userId, session.characterId, payload.combatId, payload);
      void this.analytics.combatActionAccepted(session, snapshot, payload);
      return snapshot;
    });
  }

  @SubscribeMessage('combat:leave')
  leave(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot>> {
    return this.handle(client, combatLeaveSchema, raw, async (session, payload) => {
      const snapshot = await this.combats.leave(session.userId, session.characterId, payload.combatId);
      if (!['REQUESTED', 'ACTIVE'].includes(snapshot.status)) void this.analytics.combatResolved(session, snapshot);
      return snapshot;
    });
  }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => Promise<TResult> | TResult,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.world.getBySocketId(client.id);
      if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD')
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      return { ok: true, data: await operation(session, payload) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError)
      return {
        code: error.code,
        message: this.localization.translate(error.messageKey, locale),
        details: error.details,
      };
    if (error instanceof ZodError)
      return {
        code: GAME_ERROR_CODES.INVALID_PAYLOAD,
        message: this.localization.translate('errors.payload.invalid', locale),
        details: { issues: error.issues },
      };
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
