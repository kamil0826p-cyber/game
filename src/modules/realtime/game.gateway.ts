import { randomUUID } from 'node:crypto';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { AnalyticsTrackingService } from '../../analytics/analytics-tracking.service.js';
import { FirebaseSocketAuthMiddleware } from '../../auth/firebase-socket-auth.middleware.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type {
  ChatMessagePayload,
  GameNamespace,
  GameSocket,
  MovementCommittedPayload,
  SocketAck,
  SocketErrorPayload,
  WorldSpawnPayload,
} from '../../contracts/socket.events.js';
import {
  chatSendSchema,
  createCharacterSchema,
  moveStepSchema,
  moveStopSchema,
  moveTargetSchema,
  viewportUpdateSchema,
  type ChatSendPayload,
  type CreateCharacterPayload,
  type MoveStepPayload,
  type MoveStopPayload,
  type MoveTargetPayload,
  type ViewportUpdatePayload,
} from '../../contracts/socket.schemas.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { CombatService } from '../combat/combat.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import { VisibilityService } from '../world/visibility.service.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { SessionLifecycleService } from './session-lifecycle.service.js';

const CHAT_MIN_INTERVAL_MS = 750;
const CHAT_BURST_WINDOW_MS = 10_000;
const CHAT_BURST_LIMIT = 6;
const CHAT_GUARD_TTL_MS = 10 * 60_000;
const CHAT_REQUEST_CACHE_LIMIT = 64;
const LOCAL_CHAT_RADIUS = 12;
const CHAT_REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{1,64}$/;
const CHAT_CONTROL_CHARACTER_PATTERN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B-\u200D\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu;
const CHAT_WHITESPACE_PATTERN = /\s+/gu;

interface CachedChatRequest {
  channel: ChatSendPayload['channel'];
  text: string;
  message: ChatMessagePayload;
}

interface ChatGuardState {
  lastSentAt: number;
  windowStartedAt: number;
  sentInWindow: number;
  lastSeenAt: number;
  requests: Map<string, CachedChatRequest>;
}

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(GameGateway.name);
  private readonly chatGuards = new Map<string, ChatGuardState>();
  private acceptingConnections = true;

  @WebSocketServer()
  private namespace!: GameNamespace;

  constructor(
    private readonly lifecycle: SessionLifecycleService,
    private readonly movement: MovementCoordinatorService,
    private readonly worldState: WorldStateService,
    private readonly visibility: VisibilityService,
    private readonly publisher: WorldEventsPublisher,
    private readonly localization: LocalizationService,
    private readonly authMiddleware: FirebaseSocketAuthMiddleware,
    private readonly combats: CombatService,
    private readonly analytics: AnalyticsTrackingService,
  ) {}

  afterInit(namespace: GameNamespace): void {
    namespace.use(this.authMiddleware.authenticate);
    this.publisher.bind(namespace);
    this.logger.log('Game WebSocket namespace initialized.');
  }

  async handleConnection(client: GameSocket): Promise<void> {
    try {
      this.assertAcceptingConnections();
      await this.lifecycle.initializeConnection(client);
      void this.analytics.sessionStarted(client);
    } catch (error) {
      client.emit('notification', this.toSocketError(error, client));
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: GameSocket): Promise<void> {
    try {
      const session = this.worldState.getBySocketId(client.id);
      if (session?.activeInWorld) {
        const combat = await this.combats.getActive(session.userId, session.characterId);
        if (combat) void this.analytics.combatDisconnected(session, combat);
      }
      void this.analytics.sessionEnded(client, session);
      await this.lifecycle.disconnect(client);
    } catch (error) {
      this.logger.error(
        `Disconnect handling failed for socket ${client.id}.`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  @SubscribeMessage('character:create')
  async createCharacter(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() rawPayload: unknown,
  ): Promise<SocketAck<WorldSpawnPayload>> {
    try {
      this.assertAcceptingConnections();
      const payload = this.parse<CreateCharacterPayload>(createCharacterSchema, rawPayload);
      const spawn = await this.lifecycle.createCharacter(client, {
        name: payload.name,
        characterClass: payload.characterClass,
      });
      return { ok: true, data: spawn };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('world:enter')
  async enterWorld(
    @ConnectedSocket() client: GameSocket,
  ): Promise<SocketAck<WorldSpawnPayload>> {
    try {
      this.assertAcceptingConnections();
      const data = await this.lifecycle.enterWorld(client);
      const session = this.worldState.getBySocketId(client.id);
      if (session) {
        void this.analytics.regionEntered(session, 'WORLD_ENTRY');
        void this.analytics.onboardingCheckpoint({
          session,
          journeyVersion: 1,
          checkpointKey: 'world-entered',
        });
      }
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('movement:step')
  async moveStep(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() rawPayload: unknown,
  ): Promise<SocketAck<MovementCommittedPayload>> {
    try {
      this.assertAcceptingConnections();
      const payload = this.parse<MoveStepPayload>(moveStepSchema, rawPayload);
      return await this.movement.requestDirectStep(
        this.requireSession(client),
        payload.direction,
        payload.requestId,
      );
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('movement:target')
  async moveTarget(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() rawPayload: unknown,
  ): Promise<SocketAck<{ requestId: string; pathLength: number }>> {
    try {
      this.assertAcceptingConnections();
      const payload = this.parse<MoveTargetPayload>(moveTargetSchema, rawPayload);
      const data = await this.movement.requestPath(
        this.requireSession(client),
        payload.requestId,
        payload.targetX,
        payload.targetY,
      );
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('movement:stop')
  stopMovement(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() rawPayload: unknown,
  ): SocketAck<{ stopped: boolean }> {
    try {
      this.assertAcceptingConnections();
      this.parse<MoveStopPayload>(moveStopSchema, rawPayload);
      return {
        ok: true,
        data: { stopped: this.movement.stopPath(this.requireSession(client)) },
      };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('visibility:viewport')
  async updateViewport(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() rawPayload: unknown,
  ): Promise<SocketAck<{ halfWidth: number; halfHeight: number }>> {
    try {
      this.assertAcceptingConnections();
      const payload = this.parse<ViewportUpdatePayload>(viewportUpdateSchema, rawPayload);
      const session = this.requireSession(client);
      return await this.movement.runSerialized(session, () => {
        const activeSession = this.requireSession(client);
        this.worldState.updateViewport(activeSession, payload.halfWidth, payload.halfHeight);
        this.visibility.refreshViewer(activeSession);
        return { ok: true, data: { ...activeSession.viewport } } as const;
      });
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('chat:send')
  sendChatMessage(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() rawPayload: unknown,
  ): SocketAck<ChatMessagePayload> {
    try {
      this.assertAcceptingConnections();
      const payload = this.parse<ChatSendPayload>(chatSendSchema, rawPayload);
      const session = this.requireSession(client);
      const text = this.normalizeChatText(payload.text);
      const now = Date.now();

      this.assertChatRequestId(payload.requestId);
      this.pruneChatGuards(now);

      const guard = this.getChatGuard(session.userId, now);
      const cached = guard.requests.get(payload.requestId);
      if (cached) {
        guard.lastSeenAt = now;
        if (cached.channel !== payload.channel || cached.text !== text) {
          return {
            ok: false,
            error: {
              code: 'CHAT_REQUEST_CONFLICT',
              message: 'This chat request identifier was already used for another message.',
            },
          };
        }
        return { ok: true, data: cached.message };
      }

      const rateLimitError = this.consumeChatQuota(guard, now);
      if (rateLimitError) return { ok: false, error: rateLimitError };

      const message: ChatMessagePayload = {
        id: randomUUID(),
        channel: payload.channel,
        characterId: session.characterId,
        author: session.name,
        text,
        mapId: session.mapId,
        sentAt: now,
      };

      const recipients = this.worldState.listSessions().filter((candidate) => {
        if (!candidate.activeInWorld || candidate.realmId !== session.realmId) return false;
        if (payload.channel === 'GLOBAL') return true;
        if (candidate.mapId !== session.mapId) return false;

        const deltaX = candidate.x - session.x;
        const deltaY = candidate.y - session.y;
        return deltaX * deltaX + deltaY * deltaY <= LOCAL_CHAT_RADIUS * LOCAL_CHAT_RADIUS;
      });

      this.cacheChatRequest(guard, payload.requestId, {
        channel: payload.channel,
        text,
        message,
      });

      for (const recipient of recipients) {
        this.publisher.emit(recipient.socketId, 'chat:message', message);
      }
      return { ok: true, data: message };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private requireSession(client: GameSocket) {
    const session = this.worldState.getBySocketId(client.id);
    if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    return session;
  }

  onModuleDestroy(): void {
    this.acceptingConnections = false;
    this.chatGuards.clear();
  }

  private assertAcceptingConnections(): void {
    if (!this.acceptingConnections) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
  }

  private assertChatRequestId(requestId: string): void {
    if (!CHAT_REQUEST_ID_PATTERN.test(requestId)) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
  }

  private normalizeChatText(text: string): string {
    const normalized = text
      .normalize('NFKC')
      .replace(CHAT_CONTROL_CHARACTER_PATTERN, '')
      .replace(CHAT_WHITESPACE_PATTERN, ' ')
      .trim();

    if (normalized.length === 0 || Array.from(normalized).length > 160) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    return normalized;
  }

  private getChatGuard(userId: string, now: number): ChatGuardState {
    const existing = this.chatGuards.get(userId);
    if (existing) {
      existing.lastSeenAt = now;
      return existing;
    }

    const created: ChatGuardState = {
      lastSentAt: 0,
      windowStartedAt: now,
      sentInWindow: 0,
      lastSeenAt: now,
      requests: new Map<string, CachedChatRequest>(),
    };
    this.chatGuards.set(userId, created);
    return created;
  }

  private consumeChatQuota(
    guard: ChatGuardState,
    now: number,
  ): SocketErrorPayload | undefined {
    if (now - guard.windowStartedAt >= CHAT_BURST_WINDOW_MS) {
      guard.windowStartedAt = now;
      guard.sentInWindow = 0;
    }

    const intervalRetryAfterMs = CHAT_MIN_INTERVAL_MS - (now - guard.lastSentAt);
    const windowRetryAfterMs =
      guard.sentInWindow >= CHAT_BURST_LIMIT
        ? CHAT_BURST_WINDOW_MS - (now - guard.windowStartedAt)
        : 0;
    const retryAfterMs = Math.max(intervalRetryAfterMs, windowRetryAfterMs);

    if (retryAfterMs > 0) {
      return {
        code: 'CHAT_RATE_LIMITED',
        message: 'You are sending messages too quickly.',
        details: { retryAfterMs },
      };
    }

    guard.lastSentAt = now;
    guard.sentInWindow += 1;
    guard.lastSeenAt = now;
    return undefined;
  }

  private cacheChatRequest(
    guard: ChatGuardState,
    requestId: string,
    request: CachedChatRequest,
  ): void {
    while (guard.requests.size >= CHAT_REQUEST_CACHE_LIMIT) {
      const oldestRequestId = guard.requests.keys().next().value;
      if (oldestRequestId === undefined) break;
      guard.requests.delete(oldestRequestId);
    }
    guard.requests.set(requestId, request);
  }

  private pruneChatGuards(now: number): void {
    for (const [userId, guard] of this.chatGuards) {
      if (now - guard.lastSeenAt > CHAT_GUARD_TTL_MS) {
        this.chatGuards.delete(userId);
      }
    }
  }

  private parse<T>(schema: ZodType<T>, payload: unknown): T {
    return schema.parse(payload);
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
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
      'Unhandled gateway error.',
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
