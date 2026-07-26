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
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import { VisibilityService } from '../world/visibility.service.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { SessionLifecycleService } from './session-lifecycle.service.js';

const CHAT_COOLDOWN_MS = 750;
const LOCAL_CHAT_RADIUS = 12;

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class GameGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(GameGateway.name);
  private readonly lastChatSentAt = new Map<string, number>();
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
    } catch (error) {
      client.emit('notification', this.toSocketError(error, client));
      client.disconnect(true);
    }
  }

  async handleDisconnect(client: GameSocket): Promise<void> {
    try {
      const characterId = client.data.characterId;
      if (characterId) this.lastChatSentAt.delete(characterId);
      await this.lifecycle.disconnect(client);
    } catch (error) {
      this.logger.error(`Disconnect handling failed for socket ${client.id}.`, error instanceof Error ? error.stack : undefined);
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
  async enterWorld(@ConnectedSocket() client: GameSocket): Promise<SocketAck<WorldSpawnPayload>> {
    try {
      this.assertAcceptingConnections();
      return { ok: true, data: await this.lifecycle.enterWorld(client) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('movement:step')
  async moveStep(@ConnectedSocket() client: GameSocket, @MessageBody() rawPayload: unknown): Promise<SocketAck<MovementCommittedPayload>> {
    try {
      this.assertAcceptingConnections();
      const payload = this.parse<MoveStepPayload>(moveStepSchema, rawPayload);
      return await this.movement.requestDirectStep(this.requireSession(client), payload.direction, payload.requestId);
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('movement:target')
  async moveTarget(@ConnectedSocket() client: GameSocket, @MessageBody() rawPayload: unknown): Promise<SocketAck<{ requestId: string; pathLength: number }>> {
    try {
      this.assertAcceptingConnections();
      const payload = this.parse<MoveTargetPayload>(moveTargetSchema, rawPayload);
      const data = await this.movement.requestPath(this.requireSession(client), payload.requestId, payload.targetX, payload.targetY);
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('movement:stop')
  stopMovement(@ConnectedSocket() client: GameSocket, @MessageBody() rawPayload: unknown): SocketAck<{ stopped: boolean }> {
    try {
      this.assertAcceptingConnections();
      this.parse<MoveStopPayload>(moveStopSchema, rawPayload);
      return { ok: true, data: { stopped: this.movement.stopPath(this.requireSession(client)) } };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('visibility:viewport')
  async updateViewport(@ConnectedSocket() client: GameSocket, @MessageBody() rawPayload: unknown): Promise<SocketAck<{ halfWidth: number; halfHeight: number }>> {
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
  sendChatMessage(@ConnectedSocket() client: GameSocket, @MessageBody() rawPayload: unknown): SocketAck<ChatMessagePayload> {
    try {
      this.assertAcceptingConnections();
      const payload = this.parse<ChatSendPayload>(chatSendSchema, rawPayload);
      const session = this.requireSession(client);
      const now = Date.now();
      const previous = this.lastChatSentAt.get(session.characterId) ?? 0;
      if (now - previous < CHAT_COOLDOWN_MS) {
        return { ok: false, error: { code: 'CHAT_RATE_LIMITED', message: 'You are sending messages too quickly.', details: { retryAfterMs: CHAT_COOLDOWN_MS - (now - previous) } } };
      }
      this.lastChatSentAt.set(session.characterId, now);
      const message: ChatMessagePayload = {
        id: `${session.characterId}:${now}:${payload.requestId}`,
        channel: payload.channel,
        characterId: session.characterId,
        author: session.name,
        text: payload.text,
        mapId: session.mapId,
        sentAt: now,
      };
      const recipients = this.worldState.listSessions().filter((candidate) =>
        candidate.activeInWorld &&
        candidate.realmId === session.realmId &&
        (payload.channel === 'GLOBAL' || (
          candidate.mapId === session.mapId &&
          Math.abs(candidate.x - session.x) <= LOCAL_CHAT_RADIUS &&
          Math.abs(candidate.y - session.y) <= LOCAL_CHAT_RADIUS
        )),
      );
      for (const recipient of recipients) this.publisher.emit(recipient.socketId, 'chat:message', message);
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

  onModuleDestroy(): void { this.acceptingConnections = false; }
  private assertAcceptingConnections(): void {
    if (!this.acceptingConnections) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
  }
  private parse<T>(schema: ZodType<T>, payload: unknown): T { return schema.parse(payload); }
  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) return { code: error.code, message: this.localization.translate(error.messageKey, locale), details: error.details };
    if (error instanceof ZodError) return { code: GAME_ERROR_CODES.INVALID_PAYLOAD, message: this.localization.translate('errors.payload.invalid', locale), details: { issues: error.issues } };
    this.logger.error('Unhandled gateway error.', error instanceof Error ? error.stack : undefined);
    return { code: GAME_ERROR_CODES.INTERNAL_ERROR, message: this.localization.translate('errors.internal', locale) };
  }
}
