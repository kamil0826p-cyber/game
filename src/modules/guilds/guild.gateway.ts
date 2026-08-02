import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GuildChatMessagePayload, GuildSnapshot } from '../../contracts/guild.events.js';
import type { GameSocket, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import {
  guildBuyExperienceUpgradeSchema,
  guildChatSchema,
  guildCreateSchema,
  guildDepositSchema,
  guildDisbandSchema,
  guildGetSchema,
  guildInviteSchema,
  guildKickSchema,
  guildLeaveSchema,
  guildRespondSchema,
  guildSetRoleSchema,
  guildTransferLeadershipSchema,
  guildUpdateDescriptionSchema,
  guildWithdrawSchema,
} from '../../contracts/socket.schemas.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { GuildService } from './guild.service.js';

const CHAT_MIN_INTERVAL_MS = 750;
const CHAT_BURST_WINDOW_MS = 10_000;
const CHAT_BURST_LIMIT = 6;
const CHAT_GUARD_TTL_MS = 10 * 60_000;
const CHAT_REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;
const CHAT_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;
const CHAT_WHITESPACE_PATTERN = /\s+/gu;

interface CachedRequest { text: string; message: GuildChatMessagePayload }
interface GuildChatGuard {
  lastSentAt: number;
  windowStartedAt: number;
  sentInWindow: number;
  lastSeenAt: number;
  requests: Map<string, CachedRequest>;
}

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class GuildGateway implements OnModuleDestroy {
  private readonly logger = new Logger(GuildGateway.name);
  private readonly chatGuards = new Map<string, GuildChatGuard>();

  constructor(
    private readonly guilds: GuildService,
    private readonly worldState: WorldStateService,
    private readonly movementCoordinator: MovementCoordinatorService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('guild:get')
  get(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildGetSchema, raw, (session) => this.guilds.getSnapshot(session.userId, session.characterId));
  }

  @SubscribeMessage('guild:create')
  create(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildCreateSchema, raw, (session, payload) => this.guilds.create(session.userId, session.characterId, payload));
  }

  @SubscribeMessage('guild:invite')
  invite(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildInviteSchema, raw, (session, payload) => this.guilds.invite(session.userId, session.characterId, payload.characterName));
  }

  @SubscribeMessage('guild:respond')
  respond(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildRespondSchema, raw, (session, payload) => this.guilds.respond(session.userId, session.characterId, payload.inviteId, payload.accept));
  }

  @SubscribeMessage('guild:updateDescription')
  updateDescription(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildUpdateDescriptionSchema, raw, (session, payload) => this.guilds.updateDescription(session.userId, session.characterId, payload.description));
  }

  @SubscribeMessage('guild:depositSilver')
  depositSilver(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildDepositSchema, raw, (session, payload) =>
      this.guilds.depositSilver(session.userId, session.characterId, payload.amount, payload.requestId),
    );
  }

  @SubscribeMessage('guild:withdrawSilver')
  withdrawSilver(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildWithdrawSchema, raw, (session, payload) =>
      this.guilds.withdrawSilver(session.userId, session.characterId, payload.amount, payload.requestId),
    );
  }

  @SubscribeMessage('guild:buyExperienceUpgrade')
  buyExperienceUpgrade(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildBuyExperienceUpgradeSchema, raw, (session, payload) =>
      this.guilds.purchaseExperienceUpgrade(session.userId, session.characterId, payload.requestId),
    );
  }

  @SubscribeMessage('guild:setRole')
  setRole(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildSetRoleSchema, raw, (session, payload) => this.guilds.setRole(session.userId, session.characterId, payload.targetCharacterId, payload.role));
  }

  @SubscribeMessage('guild:kick')
  kick(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildKickSchema, raw, (session, payload) => this.guilds.kick(session.userId, session.characterId, payload.targetCharacterId));
  }

  @SubscribeMessage('guild:leave')
  leave(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildLeaveSchema, raw, (session) => this.guilds.leave(session.userId, session.characterId));
  }

  @SubscribeMessage('guild:transferLeadership')
  transferLeadership(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildTransferLeadershipSchema, raw, (session, payload) => this.guilds.transferLeadership(session.userId, session.characterId, payload.targetCharacterId));
  }

  @SubscribeMessage('guild:disband')
  disband(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildSnapshot>> {
    return this.handle(client, guildDisbandSchema, raw, (session) => this.guilds.disband(session.userId, session.characterId));
  }

  @SubscribeMessage('guild:chatSend')
  async chat(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<GuildChatMessagePayload>> {
    try {
      const payload = guildChatSchema.parse(raw);
      if (!CHAT_REQUEST_ID_PATTERN.test(payload.requestId)) {
        throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
      }
      const session = this.requireSession(client);
      const text = this.normalizeChatText(payload.text);
      const guard = this.guard(session.userId);
      const cached = guard.requests.get(payload.requestId);
      if (cached) {
        if (cached.text !== text) {
          throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
        }
        return { ok: true, data: cached.message };
      }
      this.consumeQuota(guard);
      const message = await this.guilds.sendChat({
        userId: session.userId,
        characterId: session.characterId,
        author: session.name,
        text,
      });
      while (guard.requests.size >= 64) {
        const oldest = guard.requests.keys().next().value;
        if (!oldest) break;
        guard.requests.delete(oldest);
      }
      guard.requests.set(payload.requestId, { text, message });
      return { ok: true, data: message };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  onModuleDestroy(): void { this.chatGuards.clear(); }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => Promise<TResult>,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.requireSession(client);
      const data = await this.movementCoordinator.runSerialized(session, () =>
        operation(session, payload),
      );
      this.syncCharacterSilver(session, data);
      return { ok: true, data };
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

  private syncCharacterSilver(session: PlayerSession, value: unknown): void {
    if (
      value &&
      typeof value === 'object' &&
      'characterSilver' in value &&
      typeof (value as { characterSilver?: unknown }).characterSilver === 'number' &&
      session.silver !== (value as { characterSilver: number }).characterSilver
    ) {
      session.silver = (value as { characterSilver: number }).characterSilver;
      session.stateRevision += 1;
      session.dirty = true;
    }
  }

  private guard(userId: string): GuildChatGuard {
    const now = Date.now();
    for (const [key, value] of this.chatGuards) {
      if (now - value.lastSeenAt > CHAT_GUARD_TTL_MS) this.chatGuards.delete(key);
    }
    const existing = this.chatGuards.get(userId);
    if (existing) { existing.lastSeenAt = now; return existing; }
    const created: GuildChatGuard = {
      lastSentAt: 0, windowStartedAt: now, sentInWindow: 0,
      lastSeenAt: now, requests: new Map(),
    };
    this.chatGuards.set(userId, created);
    return created;
  }

  private consumeQuota(guard: GuildChatGuard): void {
    const now = Date.now();
    if (now - guard.windowStartedAt >= CHAT_BURST_WINDOW_MS) {
      guard.windowStartedAt = now;
      guard.sentInWindow = 0;
    }
    const retryAfterMs = Math.max(
      CHAT_MIN_INTERVAL_MS - (now - guard.lastSentAt),
      guard.sentInWindow >= CHAT_BURST_LIMIT ? CHAT_BURST_WINDOW_MS - (now - guard.windowStartedAt) : 0,
    );
    if (retryAfterMs > 0) {
      throw new GameError(GAME_ERROR_CODES.GUILD_CHAT_RATE_LIMITED, 'errors.guild.chatRateLimited', { retryAfterMs });
    }
    guard.lastSentAt = now;
    guard.sentInWindow += 1;
    guard.lastSeenAt = now;
  }

  private normalizeChatText(text: string): string {
    const normalized = text.normalize('NFKC').replace(CHAT_CONTROL_CHARACTER_PATTERN, '').replace(CHAT_WHITESPACE_PATTERN, ' ').trim();
    if (normalized.length === 0 || Array.from(normalized).length > 160) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    return normalized;
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) {
      return { code: error.code, message: this.localization.translate(error.messageKey, locale), ...(error.details ? { details: error.details } : {}) };
    }
    if (error instanceof ZodError) {
      return { code: GAME_ERROR_CODES.INVALID_PAYLOAD, message: this.localization.translate('errors.payload.invalid', locale), details: { issues: error.issues } };
    }
    this.logger.error('Unhandled guild gateway error.', error instanceof Error ? error.stack : undefined);
    return { code: GAME_ERROR_CODES.INTERNAL_ERROR, message: this.localization.translate('errors.internal', locale) };
  }
}
