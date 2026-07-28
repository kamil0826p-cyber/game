import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import type { GameNamespace, GameSocket, SocketAck, TradeSnapshot } from '../../contracts/socket.events.js';
import { tradeAcceptSchema, tradeCancelSchema, tradeGetSchema, tradeOfferSchema, tradeRequestSchema, tradeRespondSchema } from '../../contracts/socket.schemas.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import { WorldStateService } from '../world/world-state.service.js';
import { TradeError, TradeService } from './trade.service.js';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class TradeGateway {
  private readonly logger = new Logger(TradeGateway.name);
  @WebSocketServer() private readonly server!: GameNamespace;

  constructor(private readonly trades: TradeService, private readonly world: WorldStateService, private readonly movement: MovementCoordinatorService) {}

  @SubscribeMessage('trade:request')
  request(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeRequestSchema, raw, async (characterId, payload) => {
      const snapshot = await this.trades.request(characterId, payload.targetCharacterId);
      this.emitSnapshot(snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage('trade:respond')
  respond(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeRespondSchema, raw, async (characterId, payload) => {
      const snapshot = await this.trades.respond(characterId, payload.tradeId, payload.accept);
      this.emitSnapshot(snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage('trade:offer')
  offer(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeOfferSchema, raw, async (characterId, payload) => {
      const snapshot = await this.trades.setOffer(characterId, payload.tradeId, payload.items, payload.silver);
      this.emitSnapshot(snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage('trade:accept')
  accept(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeAcceptSchema, raw, async (characterId, payload) => {
      const snapshot = await this.trades.accept(characterId, payload.tradeId);
      this.emitSnapshot(snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage('trade:cancel')
  cancel(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeCancelSchema, raw, async (characterId, payload) => {
      const snapshot = await this.trades.cancel(characterId, payload.tradeId);
      this.emitSnapshot(snapshot);
      return snapshot;
    });
  }

  @SubscribeMessage('trade:get')
  get(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> {
    return this.handle(client, tradeGetSchema, raw, (characterId, payload) => this.trades.get(characterId, payload.tradeId));
  }

  private emitSnapshot(snapshot: TradeSnapshot): void {
    for (const characterId of [snapshot.initiator.characterId, snapshot.recipient.characterId]) {
      const session = this.world.getByCharacterId(characterId);
      if (session) this.server.to(session.socketId).emit('trade:updated', { ...snapshot, selfCharacterId: characterId });
    }
  }

  private async handle<TPayload>(client: GameSocket, schema: ZodType<TPayload>, raw: unknown, operation: (characterId: string, payload: TPayload) => Promise<TradeSnapshot>): Promise<SocketAck<TradeSnapshot>> {
    try {
      const payload = schema.parse(raw);
      const session = this.world.getBySocketId(client.id);
      if (!session?.activeInWorld || client.data.sessionState !== 'IN_WORLD') throw new TradeError('SESSION_NOT_READY', 'Sesja gry nie jest jeszcze gotowa.');
      return { ok: true, data: await this.movement.runSerialized(session, () => operation(session.characterId, payload)) };
    } catch (error) {
      if (error instanceof TradeError) return { ok: false, error: { code: error.code, message: error.message, details: error.details } };
      if (error instanceof ZodError) return { ok: false, error: { code: 'INVALID_PAYLOAD', message: 'Nieprawidłowe dane żądania.', details: { issues: error.issues } } };
      this.logger.error('Unhandled trade gateway error.', error instanceof Error ? error.stack : undefined);
      return { ok: false, error: { code: 'INTERNAL_ERROR', message: 'Wewnętrzny błąd serwera.' } };
    }
  }
}
