import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { AnalyticsTrackingService } from '../../analytics/analytics-tracking.service.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GroupSnapshot } from '../../contracts/group.events.js';
import {
  groupGetSchema,
  groupInviteSchema,
  groupKickSchema,
  groupLeaveSchema,
  groupRespondSchema,
} from '../../contracts/group.schemas.js';
import type { GameSocket, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { GroupService } from './group.service.js';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class GroupGateway {
  private readonly logger = new Logger(GroupGateway.name);

  constructor(
    private readonly groups: GroupService,
    private readonly worldState: WorldStateService,
    private readonly localization: LocalizationService,
    private readonly analytics: AnalyticsTrackingService,
  ) {}

  @SubscribeMessage('group:get')
  get(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GroupSnapshot>> {
    return this.handle(client, groupGetSchema, raw, (session) => this.groups.getSnapshot(session));
  }

  @SubscribeMessage('group:invite')
  invite(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GroupSnapshot>> {
    return this.handle(client, groupInviteSchema, raw, (session, payload) =>
      this.groups.invite(session, payload.targetCharacterId));
  }

  @SubscribeMessage('group:respond')
  respond(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GroupSnapshot>> {
    return this.handle(client, groupRespondSchema, raw, async (session, payload) => {
      const snapshot = await this.groups.respond(session, payload.inviteId, payload.accept);
      if (payload.accept && snapshot.group) {
        void this.analytics.groupJoined(session, snapshot.group.id, snapshot.group.members.length);
      }
      return snapshot;
    });
  }

  @SubscribeMessage('group:leave')
  leave(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GroupSnapshot>> {
    return this.handle(client, groupLeaveSchema, raw, (session) => this.groups.leave(session));
  }

  @SubscribeMessage('group:kick')
  kick(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GroupSnapshot>> {
    return this.handle(client, groupKickSchema, raw, (session, payload) =>
      this.groups.kick(session, payload.targetCharacterId));
  }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => TResult | Promise<TResult>,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      return { ok: true, data: await operation(this.requireSession(client), payload) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private requireSession(client: GameSocket): PlayerSession {
    const session = this.worldState.getBySocketId(client.id);
    if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    return session;
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) {
      return { code: error.code, message: this.localization.translate(error.messageKey, locale), ...(error.details ? { details: error.details } : {}) };
    }
    if (error instanceof ZodError) {
      return { code: GAME_ERROR_CODES.INVALID_PAYLOAD, message: this.localization.translate('errors.payload.invalid', locale), details: { issues: error.issues } };
    }
    this.logger.error('Unhandled group gateway error.', error instanceof Error ? error.stack : undefined);
    return { code: GAME_ERROR_CODES.INTERNAL_ERROR, message: this.localization.translate('errors.internal', locale) };
  }
}
