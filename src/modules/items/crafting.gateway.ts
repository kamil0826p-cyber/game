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
import { LocalizationService } from '../../i18n/localization.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import { NpcService } from '../npcs/npc.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { CRAFT_ORDER_MAX_REWARD_SILVER } from './craft-order.service.js';
import type {
  CraftOrderMutationResult,
  CraftingResult,
  CraftingSnapshot,
  CraftingStationSession,
} from './crafting.contracts.js';
import { CraftingService } from './crafting.service.js';

const requestId = z.string().trim().min(1).max(96);
const orderId = z.string().uuid();
const craftingRequestSchema = z.object({ requestId }).strict();
const craftingCraftSchema = z
  .object({
    requestId,
    recipeKey: z.string().trim().min(1).max(96),
  })
  .strict();
const craftOrderCreateSchema = z
  .object({
    requestId,
    recipeKey: z.string().trim().min(1).max(96),
    rewardSilver: z.number().int().min(0).max(CRAFT_ORDER_MAX_REWARD_SILVER),
  })
  .strict();
const craftOrderActionSchema = z.object({ requestId, orderId }).strict();

type CraftingRequestPayload = z.infer<typeof craftingRequestSchema>;

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class CraftingGateway {
  private readonly logger = new Logger(CraftingGateway.name);

  constructor(
    private readonly crafting: CraftingService,
    private readonly npcs: NpcService,
    private readonly worldState: WorldStateService,
    private readonly movementCoordinator: MovementCoordinatorService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('crafting:get')
  get(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CraftingSnapshot>> {
    return this.handle(client, craftingRequestSchema, raw, async (session) => {
      const station = await this.requireStation(client, session);
      const result = await this.crafting.getSnapshot(
        session.userId,
        session.characterId,
        station,
        await this.stationName(station.npcId),
      );
      this.syncSilver(client, session, result.silver);
      return result;
    });
  }

  @SubscribeMessage('crafting:craft')
  craft(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CraftingResult>> {
    return this.handle(client, craftingCraftSchema, raw, async (session, payload) => {
      const station = await this.requireStation(client, session);
      this.crafting.assertStationRecipe(station.workstationKey, payload.recipeKey);
      const result = await this.crafting.craft(
        session.userId,
        session.characterId,
        station,
        await this.stationName(station.npcId),
        payload.recipeKey,
        payload.requestId,
      );
      this.syncSilver(client, session, result.snapshot.silver);
      return result;
    });
  }

  @SubscribeMessage('crafting:orderCreate')
  createOrder(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CraftOrderMutationResult>> {
    return this.handle(client, craftOrderCreateSchema, raw, async (session, payload) => {
      const station = await this.requireStation(client, session);
      const result = await this.crafting.createOrder(
        session.userId,
        session.characterId,
        station,
        await this.stationName(station.npcId),
        payload.recipeKey,
        payload.rewardSilver,
        payload.requestId,
      );
      this.syncSilver(client, session, result.snapshot.silver);
      return result;
    });
  }

  @SubscribeMessage('crafting:orderFulfill')
  fulfillOrder(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CraftOrderMutationResult>> {
    return this.handle(client, craftOrderActionSchema, raw, async (session, payload) => {
      const station = await this.requireStation(client, session);
      const result = await this.crafting.fulfillOrder(
        session.userId,
        session.characterId,
        station,
        await this.stationName(station.npcId),
        payload.orderId,
        payload.requestId,
      );
      this.syncSilver(client, session, result.snapshot.silver);
      this.notifyOrderOwner(client, result);
      return result;
    });
  }

  @SubscribeMessage('crafting:orderCancel')
  cancelOrder(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CraftOrderMutationResult>> {
    return this.handle(client, craftOrderActionSchema, raw, async (session, payload) => {
      const station = await this.requireStation(client, session);
      const result = await this.crafting.cancelOrder(
        session.userId,
        session.characterId,
        station,
        await this.stationName(station.npcId),
        payload.orderId,
      );
      this.syncSilver(client, session, result.snapshot.silver);
      return result;
    });
  }

  @SubscribeMessage('crafting:close')
  close(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<{ closed: boolean }>> {
    return this.handle(client, craftingRequestSchema, raw, async () => {
      const closed = Boolean(client.data.craftingStation);
      client.data.craftingStation = undefined;
      return { closed };
    });
  }

  private async requireStation(
    client: GameSocket,
    session: PlayerSession,
  ): Promise<CraftingStationSession> {
    const station = client.data.craftingStation;
    if (!station) {
      throw new GameError(
        GAME_ERROR_CODES.NPC_NOT_AVAILABLE,
        'errors.npcs.notAvailable',
      );
    }
    try {
      await this.npcs.assertInteractionAvailable(station.npcId, session);
    } catch (error) {
      client.data.craftingStation = undefined;
      throw error;
    }
    return station;
  }

  private async stationName(npcId: string): Promise<string> {
    const npc = await this.npcs.getNpcIdentity(npcId);
    return npc.name;
  }

  private syncSilver(
    client: GameSocket,
    session: PlayerSession,
    balance: number,
  ): void {
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

  private notifyOrderOwner(
    client: GameSocket,
    result: CraftOrderMutationResult,
  ): void {
    if (result.mutation.kind !== 'FULFILLED') return;
    const owner = this.worldState.getByCharacterId(result.mutation.ownerCharacterId);
    if (!owner) return;
    const message =
      owner.locale === 'pl'
        ? `Zlecenie ukończone: ${result.mutation.outputName}. Przedmiot został dostarczony.`
        : `Craft order completed: ${result.mutation.outputName}. The item was delivered.`;
    client.nsp.to(owner.socketId).emit('notification', {
      code: 'CRAFT_ORDER_COMPLETED',
      message,
    });
  }

  private async handle<TPayload extends CraftingRequestPayload, TResult>(
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
      'Unhandled crafting gateway error.',
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
