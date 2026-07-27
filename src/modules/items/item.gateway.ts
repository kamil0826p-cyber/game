import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, InventorySnapshot, MerchantSnapshot, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import {
  inventoryDiscardSchema,
  inventoryItemSchema,
  inventoryMoveSchema,
  inventoryRequestSchema,
  merchantBuySchema,
  merchantSellSchema,
  type InventoryDiscardPayload,
  type InventoryItemPayload,
  type InventoryMovePayload,
  type InventoryRequestPayload,
  type MerchantBuyPayload,
  type MerchantSellPayload,
} from '../../contracts/socket.schemas.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { ItemService } from './item.service.js';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class ItemGateway {
  private readonly logger = new Logger(ItemGateway.name);

  constructor(
    private readonly items: ItemService,
    private readonly worldState: WorldStateService,
    private readonly movementCoordinator: MovementCoordinatorService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('inventory:get')
  getInventory(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryRequestSchema, raw, async (session) => this.syncSession(session, await this.items.getInventory(session.userId, session.characterId)));
  }

  @SubscribeMessage('inventory:move')
  move(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryMoveSchema, raw, async (session, payload) => this.syncSession(session, await this.items.move(session.userId, session.characterId, payload.itemId, payload.targetSlotIndex)));
  }

  @SubscribeMessage('inventory:equip')
  equip(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryItemSchema, raw, async (session, payload) => this.syncSession(session, await this.items.equip(session.userId, session.characterId, payload.itemId)));
  }

  @SubscribeMessage('inventory:unequip')
  unequip(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryItemSchema, raw, async (session, payload) => this.syncSession(session, await this.items.unequip(session.userId, session.characterId, payload.itemId)));
  }

  @SubscribeMessage('inventory:use')
  use(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryItemSchema, raw, async (session, payload) => this.syncSession(session, await this.items.use(session.userId, session.characterId, payload.itemId)));
  }

  @SubscribeMessage('inventory:discard')
  discard(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryDiscardSchema, raw, async (session, payload) => this.syncSession(session, await this.items.discard(session.userId, session.characterId, payload.itemId, payload.quantity)));
  }

  @SubscribeMessage('merchant:get')
  getMerchant(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<MerchantSnapshot>> {
    return this.handle(client, inventoryRequestSchema, raw, async (session) => {
      const snapshot = await this.items.getMerchant(session.userId, session.characterId);
      this.syncSession(session, snapshot.inventory);
      return snapshot;
    });
  }

  @SubscribeMessage('merchant:buy')
  buy(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<MerchantSnapshot>> {
    return this.handle(client, merchantBuySchema, raw, async (session, payload) => {
      const snapshot = await this.items.buy(session.userId, session.characterId, payload.itemKey, payload.quantity, payload.requestId);
      this.syncSession(session, snapshot.inventory);
      return snapshot;
    });
  }

  @SubscribeMessage('merchant:sell')
  sell(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<MerchantSnapshot>> {
    return this.handle(client, merchantSellSchema, raw, async (session, payload) => {
      const snapshot = await this.items.sell(session.userId, session.characterId, payload.itemId, payload.quantity, payload.requestId);
      this.syncSession(session, snapshot.inventory);
      return snapshot;
    });
  }

  private syncSession(session: PlayerSession, snapshot: InventorySnapshot): InventorySnapshot {
    const character = snapshot.character;
    if (!character) return snapshot;
    session.hp = character.hp;
    session.maxHp = character.maxHp;
    session.energy = character.energy;
    session.maxEnergy = character.maxEnergy;
    session.strength = character.strength;
    session.agility = character.agility;
    session.intelligence = character.intelligence;
    session.armor = character.armor;
    session.silver = character.silver;
    session.stateRevision += 1;
    session.dirty = true;
    return snapshot;
  }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => Promise<TResult>,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.worldState.getBySocketId(client.id);
      if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      const data = await this.movementCoordinator.runSerialized(session, () => operation(session, payload));
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) return { code: error.code, message: this.localization.translate(error.messageKey, locale), details: error.details };
    if (error instanceof ZodError) return { code: GAME_ERROR_CODES.INVALID_PAYLOAD, message: this.localization.translate('errors.payload.invalid', locale), details: { issues: error.issues } };
    if (this.isUniqueOperationError(error)) return { code: GAME_ERROR_CODES.INVALID_PAYLOAD, message: this.localization.translate('errors.payload.invalid', locale) };
    this.logger.error('Unhandled item gateway error.', error instanceof Error ? error.stack : undefined);
    return { code: GAME_ERROR_CODES.INTERNAL_ERROR, message: this.localization.translate('errors.internal', locale) };
  }

  private isUniqueOperationError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002';
  }
}
