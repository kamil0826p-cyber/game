import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../../common/errors/game.error.js';
import { PrismaService } from '../../../database/prisma.service.js';
import { ItemService } from '../../items/item.service.js';
import {
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
} from '../../items/itemization.rules.js';
import { WorldEventsPublisher } from '../../world/world-events.publisher.js';
import { WorldStateService } from '../../world/world-state.service.js';
import { TradeService } from './trade.service.js';

@Injectable()
export class ItemizedTradeService extends TradeService {
  constructor(
    private readonly database: PrismaService,
    items: ItemService,
    world: WorldStateService,
    publisher: WorldEventsPublisher,
  ) {
    super(database, items, world, publisher);
  }

  override async setItem(
    userId: string,
    characterId: string,
    tradeId: string,
    itemId: string,
    quantity: number,
  ) {
    if (quantity > 0) {
      const item = await this.database.inventoryItem.findFirst({
        where: { id: itemId, characterId, character: { userId } },
        include: { itemDefinition: true },
      });
      if (!item || item.equippedSlot || item.quantity < quantity) this.itemInvalid();
      this.assertTradeable(item);
    }
    return super.setItem(userId, characterId, tradeId, itemId, quantity);
  }

  override async accept(userId: string, characterId: string, tradeId: string) {
    const trade = await this.database.tradeSession.findUnique({
      where: { id: tradeId },
      include: {
        offers: {
          include: {
            inventoryItem: { include: { itemDefinition: true } },
          },
        },
      },
    });
    if (trade) {
      for (const offer of trade.offers) this.assertTradeable(offer.inventoryItem);
    }
    return super.accept(userId, characterId, tradeId);
  }

  private assertTradeable(item: {
    id: string;
    instanceData: unknown;
    itemDefinition: { key: string; metadata: unknown };
  }): void {
    const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata as never);
    const snapshot = readItemInstanceSnapshot({
      instanceData: item.instanceData as never,
      definitionKey: item.itemDefinition.key,
      metadata,
      legacyOperationId: `trade-read:${item.id}`,
    });
    if (snapshot.tradePolicy !== 'TRADEABLE' || snapshot.boundCharacterId) {
      this.itemInvalid({
        reason: 'ITEM_NOT_TRADEABLE',
        tradePolicy: snapshot.tradePolicy,
      });
    }
  }

  private itemInvalid(details?: Record<string, unknown>): never {
    throw new GameError(
      GAME_ERROR_CODES.TRADE_ITEM_INVALID,
      'errors.trade.itemInvalid',
      details,
    );
  }
}
