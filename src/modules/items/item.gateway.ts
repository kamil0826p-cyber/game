import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, InventorySnapshot, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import {
  inventoryDiscardSchema,
  inventoryItemSchema,
  inventoryMoveSchema,
  inventoryRequestSchema,
  type InventoryDiscardPayload,
  type InventoryItemPayload,
  type InventoryMovePayload,
  type InventoryRequestPayload,
} from '../../contracts/socket.schemas.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { WorldStateService } from '../world/world-state.service.js';
import { ItemService } from './item.service.js';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class ItemGateway {
  private readonly logger = new Logger(ItemGateway.name);

  constructor(
    private readonly items: ItemService,
    private readonly worldState: WorldStateService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('inventory:get')
  getInventory(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryRequestSchema, raw, (session) => this.items.getInventory(session.userId, session.characterId));
  }

  @SubscribeMessage('inventory:move')
  move(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryMoveSchema, raw, (session, payload) => this.items.move(session.userId, session.characterId, payload.itemId, payload.targetSlotIndex));
  }

  @SubscribeMessage('inventory:equip')
  equip(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryItemSchema, raw, (session, payload) => this.items.equip(session.userId, session.characterId, payload.itemId));
  }

  @SubscribeMessage('inventory:unequip')
  unequip(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryItemSchema, raw, (session, payload) => this.items.unequip(session.userId, session.characterId, payload.itemId));
  }

  @SubscribeMessage('inventory:use')
  use(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryItemSchema, raw, async (session, payload) => {
      const snapshot = await this.items.use(session.userId, session.characterId, payload.itemId);
      if (snapshot.character) {
        session.hp = snapshot.character.hp;
        session.energy = snapshot.character.energy;
        session.stateRevision += 1;
        session.dirty = true;
      }
      return snapshot;
    });
  }

  @SubscribeMessage('inventory:discard')
  discard(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<InventorySnapshot>> {
    return this.handle(client, inventoryDiscardSchema, raw, (session, payload) => this.items.discard(session.userId, session.characterId, payload.itemId, payload.quantity));
  }

  private async handle<TPayload extends InventoryRequestPayload | InventoryMovePayload | InventoryItemPayload | InventoryDiscardPayload>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: NonNullable<ReturnType<WorldStateService['getBySocketId']>>, payload: TPayload) => Promise<InventorySnapshot>,
  ): Promise<SocketAck<InventorySnapshot>> {
    try {
      const payload = schema.parse(raw);
      const session = this.worldState.getBySocketId(client.id);
      if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }
      return { ok: true, data: await operation(session, payload) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) return { code: error.code, message: this.localization.translate(error.messageKey, locale), details: error.details };
    if (error instanceof ZodError) return { code: GAME_ERROR_CODES.INVALID_PAYLOAD, message: this.localization.translate('errors.payload.invalid', locale), details: { issues: error.issues } };
    this.logger.error('Unhandled item gateway error.', error instanceof Error ? error.stack : undefined);
    return { code: GAME_ERROR_CODES.INTERNAL_ERROR, message: this.localization.translate('errors.internal', locale) };
  }
}
