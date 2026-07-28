import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../../common/errors/game.error.js';
import type { GameSocket, SocketAck, SocketErrorPayload, TradeSnapshot } from '../../../contracts/socket.events.js';
import { tradeActionSchema, tradeGetActiveSchema, tradeRequestSchema, tradeRespondSchema, tradeSetItemSchema, tradeSetSilverSchema } from '../../../contracts/socket.schemas.js';
import { LocalizationService } from '../../../i18n/localization.service.js';
import { MovementCoordinatorService } from '../../movement/movement-coordinator.service.js';
import type { PlayerSession } from '../../world/player-session.types.js';
import { WorldStateService } from '../../world/world-state.service.js';
import { TradeService } from './trade.service.js';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class TradeGateway {
  private readonly logger = new Logger(TradeGateway.name);
  constructor(private readonly trades: TradeService, private readonly worldState: WorldStateService, private readonly movementCoordinator: MovementCoordinatorService, private readonly localization: LocalizationService) {}

  @SubscribeMessage('trade:getActive')
  getActive(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot | null>> { return this.handle(client, tradeGetActiveSchema, raw, (session) => this.trades.getActive(session.userId, session.characterId)); }
  @SubscribeMessage('trade:request')
  request(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> { return this.handle(client, tradeRequestSchema, raw, (session, payload) => this.trades.request(session.userId, session.characterId, payload.targetCharacterId)); }
  @SubscribeMessage('trade:respond')
  respond(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> { return this.handle(client, tradeRespondSchema, raw, (session, payload) => this.trades.respond(session.userId, session.characterId, payload.tradeId, payload.accept)); }
  @SubscribeMessage('trade:setItem')
  setItem(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> { return this.handle(client, tradeSetItemSchema, raw, (session, payload) => this.trades.setItem(session.userId, session.characterId, payload.tradeId, payload.itemId, payload.quantity)); }
  @SubscribeMessage('trade:setSilver')
  setSilver(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> { return this.handle(client, tradeSetSilverSchema, raw, (session, payload) => this.trades.setSilver(session.userId, session.characterId, payload.tradeId, payload.silver)); }
  @SubscribeMessage('trade:accept')
  accept(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> { return this.handle(client, tradeActionSchema, raw, (session, payload) => this.trades.accept(session.userId, session.characterId, payload.tradeId)); }
  @SubscribeMessage('trade:cancel')
  cancel(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<TradeSnapshot>> { return this.handle(client, tradeActionSchema, raw, (session, payload) => this.trades.cancel(session.userId, session.characterId, payload.tradeId)); }

  private async handle<TPayload, TResult>(client: GameSocket, schema: ZodType<TPayload>, raw: unknown, operation: (session: PlayerSession, payload: TPayload) => Promise<TResult>): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.worldState.getBySocketId(client.id);
      if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      return { ok: true, data: await this.movementCoordinator.runSerialized(session, () => operation(session, payload)) };
    } catch (error) { return { ok: false, error: this.toSocketError(error, client) }; }
  }
  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) return { code: error.code, message: this.localization.translate(error.messageKey, locale), ...(error.details ? { details: error.details } : {}) };
    if (error instanceof ZodError) return { code: GAME_ERROR_CODES.INVALID_PAYLOAD, message: this.localization.translate('errors.payload.invalid', locale), details: { issues: error.issues } };
    this.logger.error('Unhandled trade gateway error.', error instanceof Error ? error.stack : undefined);
    return { code: GAME_ERROR_CODES.INTERNAL_ERROR, message: this.localization.translate('errors.internal', locale) };
  }
}
