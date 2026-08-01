import type { InventorySnapshot } from '../../contracts/socket.events.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { ItemServiceBase } from './item-service.base.js';

export class ItemEquipmentService extends ItemServiceBase {
  async move(userId: string, characterId: string, itemId: string, targetSlotIndex: number): Promise<InventorySnapshot> {
    this.assertSlot(targetSlotIndex);
    await this.prisma.$transaction(async (tx) => {
      const source = await this.requireOwnedItem(tx, userId, characterId, itemId);
      if (source.slotIndex === targetSlotIndex) return;
      const target = await tx.inventoryItem.findUnique({
        where: { characterId_slotIndex: { characterId, slotIndex: targetSlotIndex } },
        include: { itemDefinition: true },
      });
      if (!target) {
        await tx.inventoryItem.update({ where: { id: source.id }, data: { slotIndex: targetSlotIndex } });
        return;
      }
      const sourceView = this.itemView(source);
      const targetView = this.itemView(target);
      if (
        source.itemDefinitionId === target.itemDefinitionId &&
        JSON.stringify(source.instanceData) === JSON.stringify(target.instanceData) &&
        !source.equippedSlot &&
        !target.equippedSlot &&
        target.quantity < targetView.stackLimit
      ) {
        const moved = Math.min(source.quantity, targetView.stackLimit - target.quantity);
        await tx.inventoryItem.update({ where: { id: target.id }, data: { quantity: { increment: moved } } });
        if (moved === source.quantity) await tx.inventoryItem.delete({ where: { id: source.id } });
        else await tx.inventoryItem.update({ where: { id: source.id }, data: { quantity: { decrement: moved } } });
        return;
      }
      void sourceView;
      await tx.inventoryItem.update({ where: { id: source.id }, data: { slotIndex: -1 } });
      await tx.inventoryItem.update({ where: { id: target.id }, data: { slotIndex: source.slotIndex } });
      await tx.inventoryItem.update({ where: { id: source.id }, data: { slotIndex: targetSlotIndex } });
    });
    return this.snapshot(userId, characterId, true);
  }

  async equip(userId: string, characterId: string, itemId: string): Promise<InventorySnapshot> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      const metadata = this.metadata(this.itemView(item).metadata);
      if (metadata.category !== 'EQUIPMENT' || !metadata.equipmentSlot) this.invalidItem();
      if (metadata.requiredClass && metadata.requiredClass !== item.character.class) this.invalidItem();
      if ((metadata.minimumLevel ?? 1) > item.character.level) this.invalidItem();
      const base = await this.baseStatsBeforeEquipmentChange(tx, characterId);
      await tx.inventoryItem.updateMany({
        where: { characterId, equippedSlot: metadata.equipmentSlot, NOT: { id: item.id } },
        data: { equippedSlot: null },
      });
      await tx.inventoryItem.update({ where: { id: item.id }, data: { equippedSlot: metadata.equipmentSlot } });
      await this.applyEffectiveStats(tx, characterId, base);
    });
    return this.snapshot(userId, characterId, true);
  }

  async unequip(userId: string, characterId: string, itemId: string): Promise<InventorySnapshot> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      const base = await this.baseStatsBeforeEquipmentChange(tx, characterId);
      await tx.inventoryItem.update({ where: { id: item.id }, data: { equippedSlot: null } });
      await this.applyEffectiveStats(tx, characterId, base);
    });
    return this.snapshot(userId, characterId, true);
  }

  async use(userId: string, characterId: string, itemId: string): Promise<InventorySnapshot> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      const metadata = this.metadata(this.itemView(item).metadata);
      if (metadata.category !== 'CONSUMABLE' || !metadata.effect) this.invalidItem();
      const hp = Math.min(item.character.maxHp, item.character.hp + (metadata.effect.hp ?? 0));
      const energy = Math.min(item.character.maxEnergy, item.character.energy + (metadata.effect.energy ?? 0));
      if (hp === item.character.hp && energy === item.character.energy) {
        throw new GameError(GAME_ERROR_CODES.ITEM_EFFECT_NOT_NEEDED, 'errors.items.effectNotNeeded');
      }
      await tx.character.update({ where: { id: characterId }, data: { hp, energy } });
      if (item.quantity === 1) await tx.inventoryItem.delete({ where: { id: item.id } });
      else await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: 1 } } });
    });
    return this.snapshot(userId, characterId, true);
  }

  async destroy(userId: string, characterId: string, itemId: string, quantity: number): Promise<InventorySnapshot> {
    this.assertQuantity(quantity);
    await this.prisma.$transaction(async (tx) => {
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      if (item.equippedSlot) throw new GameError(GAME_ERROR_CODES.ITEM_EQUIPPED, 'errors.items.equipped');
      if (quantity > item.quantity) this.invalidItem();
      if (quantity === item.quantity) await tx.inventoryItem.delete({ where: { id: item.id } });
      else await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: quantity } } });
    });
    return this.snapshot(userId, characterId, true);
  }

}
