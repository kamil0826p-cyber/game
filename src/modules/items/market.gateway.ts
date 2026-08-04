import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { z, ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type {
  GameSocket,
  SocketAck,
  SocketErrorPayload,
} from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import { NpcService } from '../npcs/npc.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import type {
  MarketMutationResult,
  MarketSnapshot,
  MarketStationSession,
} from './market.contracts.js';
import {
  MARKET_MAX_PRICE_SILVER,
  MarketService,
} from './market.service.js';

const requestId = z.string().trim().min(1).max(96);
const marketRequestSchema = z.object({ requestId }).strict();
const marketListSchema = z
  .object({
    requestId,
    itemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(9_999),
    priceSilver: z.number().int().min(1).max(MARKET_MAX_PRICE_SILVER),
  })
  .strict();
const marketActionSchema = z
  .object({ requestId, listingId: z.string().uuid() })
  .strict();

type MarketRequestPayload = z.infer<typeof marketRequestSchema>;

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class MarketGateway {
  private readonly logger = new Logger(MarketGateway.name);

  constructor(
    private readonly market: MarketService,
    private readonly npcs: NpcService,
    private readonly prisma: PrismaService,
    private readonly worldState: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
    private readonly movementCoordinator: MovementCoordinatorService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('market:get')
  get(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<MarketSnapshot>> {
    return this.handle(client, marketRequestSchema, raw, async (session) => {
      const station = await this.requireStation(client, session);
      return this.market.getSnapshot(
        session.userId,
        session.characterId,
        station,
        await this.stationName(station.npcId),
      );
    });
  }

  @SubscribeMessage('market:list')
  list(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<MarketMutationResult>> {
    return this.handle(client, marketListSchema, raw, async (session, payload) => {
      const station = await this.requireStation(client, session);
      const result = await this.market.list(
        session.userId,
        session.characterId,
        { station, npcName: await this.stationName(station.npcId) },
        payload.itemId,
        payload.quantity,
        payload.priceSilver,
        payload.requestId,
      );
      this.syncSilver(client, session, result.snapshot.silver);
      return result;
    });
  }

  @SubscribeMessage('market:buy')
  buy(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<MarketMutationResult>> {
    return this.handle(client, marketActionSchema, raw, async (session, payload) => {
      const station = await this.requireStation(client, session);
      const result = await this.market.buy(
        session.userId,
        session.characterId,
        { station, npcName: await this.stationName(station.npcId) },
        payload.listingId,
        payload.requestId,
      );
      this.syncSilver(client, session, result.snapshot.silver);
      await this.syncSellerAfterSale(result);
      return result;
    });
  }

  @SubscribeMessage('market:cancel')
  cancel(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<MarketMutationResult>> {
    return this.handle(client, marketActionSchema, raw, async (session, payload) => {
      const station = await this.requireStation(client, session);
      const result = await this.market.cancel(
        session.userId,
        session.characterId,
        { station, npcName: await this.stationName(station.npcId) },
        payload.listingId,
      );
      this.syncSilver(client, session, result.snapshot.silver);
      return result;
    });
  }

  @SubscribeMessage('market:close')
  close(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<{ closed: boolean }>> {
    return this.handle(client, marketRequestSchema, raw, async () => {
      const closed = Boolean(client.data.marketStation);
      client.data.marketStation = undefined;
      return { closed };
    });
  }

  private async requireStation(
    client: GameSocket,
    session: PlayerSession,
  ): Promise<MarketStationSession> {
    const station = client.data.marketStation;
    if (!station) {
      throw new GameError(GAME_ERROR_CODES.NPC_NOT_AVAILABLE, 'errors.npcs.notAvailable');
    }
    try {
      await this.npcs.assertInteractionAvailable(station.npcId, session);
    } catch (error) {
      client.data.marketStation = undefined;
      throw error;
    }
    return station;
  }

  private async stationName(npcId: string): Promise<string> {
    return (await this.npcs.getNpcIdentity(npcId)).name;
  }

  private syncSilver(client: GameSocket, session: PlayerSession, balance: number): void {
    const previous = session.silver;
    if (previous === balance) return;
    session.silver = balance;
    session.stateRevision += 1;
    session.dirty = true;
    client.emit('character:currencyUpdated', {
      characterId: session.characterId,
      currency: 'SILVER',
      amount: balance - previous,
      balance,
    });
  }

  private async syncSellerAfterSale(result: MarketMutationResult): Promise<void> {
    const sellerCharacterId = result.mutation.sellerCharacterId;
    if (!sellerCharacterId || result.mutation.kind !== 'PURCHASED') return;
    const session = this.worldState.getByCharacterId(sellerCharacterId);
    if (!session) return;
    const character = await this.prisma.character.findUnique({
      where: { id: sellerCharacterId },
      select: { silver: true },
    });
    if (!character) return;
    const previous = session.silver;
    session.silver = character.silver;
    session.stateRevision += 1;
    session.dirty = true;
    if (previous !== character.silver) {
      this.publisher.emit(session.socketId, 'character:currencyUpdated', {
        characterId: sellerCharacterId,
        currency: 'SILVER',
        amount: character.silver - previous,
        balance: character.silver,
      });
    }
    this.publisher.emit(session.socketId, 'notification', {
      code: 'MARKET_ITEM_SOLD',
      message:
        session.locale === 'pl'
          ? `Sprzedano ${result.mutation.quantity} × ${result.mutation.itemName}. Srebro zostało dopisane do salda.`
          : `Sold ${result.mutation.quantity} × ${result.mutation.itemName}. Silver was added to your balance.`,
    });
  }

  private async handle<TPayload extends MarketRequestPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => Promise<TResult>,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.worldState.getBySocketId(client.id);
      if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }
      const data = await this.movementCoordinator.runSerialized(session, () =>
        operation(session, payload),
      );
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
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
      'Unhandled market gateway error.',
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
