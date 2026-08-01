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
      const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
      const snapshot = readItemInstanceSnapshot({
        instanceData: item.instanceData,
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
    return super.setItem(userId, characterId, tradeId, itemId, quantity);
  }

  private itemInvalid(details?: Record<string, unknown>): never {
    throw new GameError(
      GAME_ERROR_CODES.TRADE_ITEM_INVALID,
      'errors.trade.itemInvalid',
      details,
    );
  }
}
