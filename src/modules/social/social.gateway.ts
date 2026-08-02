import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import {
  socialAnnouncementCreateSchema,
  socialBankDepositSchema,
  socialBankWithdrawSchema,
  socialBlockSchema,
  socialContactSchema,
  socialEventCreateSchema,
  socialEventRsvpSchema,
  socialFinderApplySchema,
  socialFinderCreateSchema,
  socialFinderMutationSchema,
  socialFinderReadySchema,
  socialFinderRespondSchema,
  socialGetSchema,
  socialGuildCreateObjectiveSchema,
  socialGuildPermissionSchema,
  socialGuildSettleSchema,
  socialMentorProfileSchema,
  socialMentorshipCompleteSchema,
  socialMentorshipStartSchema,
} from '../../contracts/social.schemas.js';
import type { SocialDashboardView } from './social.types.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { SocialService } from './social.service.js';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class SocialGateway {
  private readonly logger = new Logger(SocialGateway.name);

  constructor(
    private readonly social: SocialService,
    private readonly world: WorldStateService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('social:get')
  get(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialGetSchema, raw, (session) => this.social.dashboard(session));
  }

  @SubscribeMessage('social:finderCreate')
  finderCreate(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialFinderCreateSchema, raw, (session, payload) => this.social.createFinder(session, payload));
  }

  @SubscribeMessage('social:finderApply')
  finderApply(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialFinderApplySchema, raw, (session, payload) => this.social.applyFinder(session, payload));
  }

  @SubscribeMessage('social:finderRespond')
  finderRespond(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialFinderRespondSchema, raw, (session, payload) => this.social.respondFinder(session, payload));
  }

  @SubscribeMessage('social:finderReady')
  finderReady(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialFinderReadySchema, raw, (session, payload) => this.social.readyFinder(session, payload));
  }

  @SubscribeMessage('social:finderStart')
  finderStart(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialFinderMutationSchema, raw, (session, payload) => this.social.startFinder(session, payload.operationId, payload.listingId));
  }

  @SubscribeMessage('social:finderCancel')
  finderCancel(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialFinderMutationSchema, raw, (session, payload) => this.social.cancelFinder(session, payload.operationId, payload.listingId));
  }

  @SubscribeMessage('social:contactAdd')
  contactAdd(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialContactSchema, raw, (session, payload) => this.social.addContact(session, payload.operationId, payload.targetCharacterId));
  }

  @SubscribeMessage('social:blockSet')
  blockSet(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialBlockSchema, raw, (session, payload) => this.social.setBlock(session, payload.operationId, payload.targetCharacterId, payload.blocked));
  }

  @SubscribeMessage('social:mentorProfile')
  mentorProfile(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialMentorProfileSchema, raw, (session, payload) => this.social.setMentorProfile(session, payload));
  }

  @SubscribeMessage('social:mentorshipStart')
  mentorshipStart(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialMentorshipStartSchema, raw, (session, payload) => this.social.startMentorship(session, payload));
  }

  @SubscribeMessage('social:mentorshipComplete')
  mentorshipComplete(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialMentorshipCompleteSchema, raw, (session, payload) => this.social.completeMentorship(session, payload.operationId, payload.mentorshipId));
  }

  @SubscribeMessage('social:contractCreate')
  contractCreate(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialGuildCreateObjectiveSchema, raw, (session, payload) => this.social.createContract(session, payload));
  }

  @SubscribeMessage('social:contractSettle')
  contractSettle(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialGuildSettleSchema, raw, (session, payload) => this.social.settleContract(session, payload.operationId, payload.instanceId));
  }

  @SubscribeMessage('social:projectCreate')
  projectCreate(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialGuildCreateObjectiveSchema, raw, (session, payload) => this.social.createProject(session, payload));
  }

  @SubscribeMessage('social:projectSettle')
  projectSettle(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialGuildSettleSchema, raw, (session, payload) => this.social.settleProject(session, payload.operationId, payload.instanceId));
  }

  @SubscribeMessage('social:guildPermission')
  guildPermission(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialGuildPermissionSchema, raw, (session, payload) => this.social.setGuildPermission(session, payload.operationId, payload.role, payload.permission, payload.allowed));
  }

  @SubscribeMessage('social:bankDeposit')
  bankDeposit(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialBankDepositSchema, raw, (session, payload) => this.social.depositBank(session, payload));
  }

  @SubscribeMessage('social:bankWithdraw')
  bankWithdraw(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialBankWithdrawSchema, raw, (session, payload) => this.social.withdrawBank(session, payload));
  }

  @SubscribeMessage('social:announcementCreate')
  announcementCreate(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialAnnouncementCreateSchema, raw, (session, payload) => this.social.createAnnouncement(session, payload));
  }

  @SubscribeMessage('social:eventCreate')
  eventCreate(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialEventCreateSchema, raw, (session, payload) => this.social.createEvent(session, payload));
  }

  @SubscribeMessage('social:eventRsvp')
  eventRsvp(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<SocialDashboardView>> {
    return this.handle(client, socialEventRsvpSchema, raw, (session, payload) => this.social.rsvpEvent(session, payload.operationId, payload.eventId, payload.response));
  }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => Promise<TResult>,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      return { ok: true, data: await operation(this.requireSession(client), payload) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private requireSession(client: GameSocket): PlayerSession {
    const session = this.world.getBySocketId(client.id);
    if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    return session;
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) {
      return {
        code: error.code,
        message: this.localization.translate(error.messageKey, locale),
        ...(error.details ? { details: error.details } : {}),
      };
    }
    if (error instanceof ZodError) {
      return {
        code: GAME_ERROR_CODES.INVALID_PAYLOAD,
        message: this.localization.translate('errors.payload.invalid', locale),
        details: { issues: error.issues },
      };
    }
    this.logger.error('Unhandled social gateway error.', error instanceof Error ? error.stack : undefined);
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
