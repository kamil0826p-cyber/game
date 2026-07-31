import type { MerchantSnapshot } from '../../contracts/socket.events.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { ItemEquipmentService } from './item-service.equipment.js';

export class ItemCommerceService extends ItemEquipmentService {
  async buy(
    userId: string,
    characterId: string,
    npcId: string,
    itemKey: string,
    quantity: number,
    operationId: string,
  ): Promise<MerchantSnapshot> {
    this.assertQuantity(quantity);
    await this.prisma.$transaction(async (tx) => {
      const character = await this.requireCharacter(tx, userId, characterId);
      const merchant = await this.requireMerchant(tx, character, npcId);
      if (!merchant.itemKeys.includes(itemKey)) this.invalidItem();
      const definition = await tx.itemDefinition.findUnique({ where: { key: itemKey } });
      if (!definition) this.invalidItem();
      const metadata = this.metadata(definition.metadata);
      const total = metadata.buyPriceSilver * quantity;
      if (total <= 0) this.invalidItem();
      if (character.silver < total) {
        throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver', {
          required: total,
          available: character.silver,
        });
      }
      const snapshot = this.itemSnapshot(definition);
      await this.addToInventory(tx, characterId, definition.id, definition.stackLimit, quantity, snapshot);
      const updated = await tx.character.update({
        where: { id: characterId },
        data: { silver: { decrement: total } },
        select: { silver: true },
      });
      const eventOperationId = `shop-buy:${operationId}`;
      await tx.characterCurrencyLedger.create({
        data: {
          characterId,
          operationId: eventOperationId,
          currency: 'SILVER',
          direction: 'DEBIT',
          amount: total,
          reason: 'NPC_ITEM_PURCHASE',
          balanceAfter: updated.silver,
          metadata: { itemKey, quantity, unitPrice: metadata.buyPriceSilver, npcId: merchant.id },
        },
      });
      await this.domainEvents.append(tx, {
        operationId: eventOperationId,
        type: 'ItemAcquired',
        actorCharacterId: characterId,
        mapId: character.mapId,
        payload: {
          characterId,
          itemKey,
          quantity,
          source: 'NPC_MERCHANT',
          npcId: merchant.id,
          audit: [
            {
              characterId,
              resourceType: 'SILVER',
              amount: -total,
              balanceAfter: updated.silver,
              reason: 'NPC_ITEM_PURCHASE',
              metadata: { itemKey, quantity, npcId: merchant.id },
            },
            {
              characterId,
              resourceType: 'ITEM',
              resourceKey: itemKey,
              amount: quantity,
              reason: 'NPC_ITEM_PURCHASE',
              metadata: { npcId: merchant.id },
            },
          ],
        },
      });
    });
    return this.merchantSnapshot(userId, characterId, npcId);
  }

  async sell(
    userId: string,
    characterId: string,
    npcId: string,
    itemId: string,
    quantity: number,
    operationId: string,
  ): Promise<MerchantSnapshot> {
    this.assertQuantity(quantity);
    await this.prisma.$transaction(async (tx) => {
      const character = await this.requireCharacter(tx, userId, characterId);
      const merchant = await this.requireMerchant(tx, character, npcId);
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      if (item.equippedSlot) throw new GameError(GAME_ERROR_CODES.ITEM_EQUIPPED, 'errors.items.equipped');
      if (quantity > item.quantity) this.invalidItem();
      const view = this.itemView(item);
      const metadata = this.metadata(view.metadata);
      if (metadata.sellable === false || metadata.sellPriceSilver <= 0) {
        throw new GameError(GAME_ERROR_CODES.ITEM_NOT_SELLABLE, 'errors.items.notSellable');
      }
      const total = metadata.sellPriceSilver * quantity;
      if (quantity === item.quantity) await tx.inventoryItem.delete({ where: { id: item.id } });
      else await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: quantity } } });
      const updated = await tx.character.update({
        where: { id: characterId },
        data: { silver: { increment: total } },
        select: { silver: true },
      });
      await tx.characterCurrencyLedger.create({
        data: {
          characterId,
          operationId: `shop-sell:${operationId}`,
          currency: 'SILVER',
          direction: 'CREDIT',
          amount: total,
          reason: 'NPC_ITEM_SALE',
          balanceAfter: updated.silver,
          metadata: { itemKey: view.key, quantity, unitPrice: metadata.sellPriceSilver, npcId: merchant.id },
        },
      });
    });
    return this.merchantSnapshot(userId, characterId, npcId);
  }

}
