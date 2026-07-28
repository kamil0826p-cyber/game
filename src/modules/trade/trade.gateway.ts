import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, SocketAck, SocketErrorPayload, TradeSnapshot } from '../../contracts/socket.events.js';
import { tradeCancelSchema, tradeConfirmSchema, tradeOfferSchema, tradeRequestSchema, tradeRespondSchema } from '../../contracts/socket.schemas.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { TradeService } from './trade.service.js';

type TradeServerEvent = 'trade:requested' | 'trade:updated' | 'trade:completed' | 'trade:cancelled';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class TradeGateway {
  private readonly logger = new Logger(TradeGateway.name);

  constructor(
    private readonly trades: TradeService,
    private readonly world: WorldStateService,
    private readonly movement: MovementCoordinatorService,
    private readonly localization: LocalizationService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  @SubscribeMessage('trade:request')
  request(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeRequestSchema, raw, async (session, payload) => {
      const snapshot = await this.trades.request(session.characterId, payload.targetCharacterId);
      await this.emitSnapshot(snapshot, 'trade:requested');
      return snapshot;
    });
  }

  @SubscribeMessage('trade:respond')
  respond(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeRespondSchema, raw, async (session, payload) => {
      const snapshot = await this.trades.respond(payload.tradeId, session.characterId, payload.accept);
      await this.emitSnapshot(snapshot, payload.accept ? 'trade:updated' : 'trade:cancelled');
      return snapshot;
    });
  }

  @SubscribeMessage('trade:offer')
  offer(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeOfferSchema, raw, async (session, payload) => {
      const snapshot = await this.trades.setOffer(payload.tradeId, session.characterId, payload.items, payload.silver);
      await this.emitSnapshot(snapshot, 'trade:updated');
      return snapshot;
    });
  }

  @SubscribeMessage('trade:confirm')
  confirm(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeConfirmSchema, raw, async (session, payload) => {
      const snapshot = await this.trades.confirm(payload.tradeId, session.characterId);
      this.syncLiveBalances(snapshot);
      await this.emitSnapshot(snapshot, snapshot.status === 'COMPLETED' ? 'trade:completed' : 'trade:updated');
      return snapshot;
    });
  }

  @SubscribeMessage('trade:cancel')
  cancel(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeCancelSchema, raw, async (session, payload) => {
      const snapshot = await this.trades.cancel(payload.tradeId, session.characterId);
      await this.emitSnapshot(snapshot, 'trade:cancelled');
      return snapshot;
    });
  }

  private async emitSnapshot(snapshot: TradeSnapshot, event: TradeServerEvent): Promise<void> {
    for (const characterId of [snapshot.initiator.characterId, snapshot.recipient.characterId]) {
      const socketId = this.world.getByCharacterId(characterId)?.socketId;
      if (!socketId) continue;
      const viewerSnapshot = await this.trades.snapshot(snapshot.id, characterId);
      this.publisher.emit(socketId, event, viewerSnapshot);
    }
  }

  private syncLiveBalances(snapshot: TradeSnapshot): void {
    if (snapshot.status !== 'COMPLETED') return;
    for (const characterId of [snapshot.initiator.characterId, snapshot.recipient.characterId]) {
      const session = this.world.getByCharacterId(characterId);
      if (!session) continue;
      const outgoing = characterId === snapshot.initiator.characterId ? snapshot.initiator.silver : snapshot.recipient.silver;
      const incoming = characterId === snapshot.initiator.characterId ? snapshot.recipient.silver : snapshot.initiator.silver;
      session.silver += incoming - outgoing;
      session.stateRevision += 1;
      session.dirty = true;
    }
  }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => Promise<TResult>,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.world.getBySocketId(client.id);
      if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      const data = await this.movement.runSerialized(session, () => operation(session, payload));
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) return { code: error.code, message: this.localization.translate(error.messageKey, locale), details: error.details };
    if (error instanceof ZodError) return { code: GAME_ERROR_CODES.INVALID_PAYLOAD, message: this.localization.translate('errors.payload.invalid', locale), details: { issues: error.issues } };
    this.logger.error('Unhandled trade gateway error.', error instanceof Error ? error.stack : undefined);
    return { code: GAME_ERROR_CODES.INTERNAL_ERROR, message: this.localization.translate('errors.internal', locale) };
  }
}
