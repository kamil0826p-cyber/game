import { Injectable } from '@nestjs/common';
import type { CharacterClass, EquipmentSlot, ItemCategory } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { InventorySnapshot } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CharacterProgressionService } from '../characters/progression/character-progression.service.js';
import { ItemService } from './item.service.js';

interface EquipmentMetadata {
  category?: ItemCategory;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel?: number;
}

@Injectable()
export class CanonicalItemService extends ItemService {
  constructor(
    private readonly database: PrismaService,
    private readonly progression: CharacterProgressionService,
  ) {
    super(database);
  }

  override async equip(
    userId: string,
    characterId: string,
    itemId: string,
  ): Promise<InventorySnapshot> {
    await this.database.$transaction(async (transaction) => {
      const item = await this.requireEquipment(transaction, userId, characterId, itemId);
      const metadata = this.equipmentMetadata(item.itemDefinition.metadata);
      if (metadata.category !== 'EQUIPMENT' || !metadata.equipmentSlot) this.invalidItem();
      if (metadata.requiredClass && metadata.requiredClass !== item.character.class) this.invalidItem();
      if ((metadata.minimumLevel ?? 1) > item.character.level) this.invalidItem();

      await this.progression.recomputeInTransaction(transaction, characterId);
      await transaction.inventoryItem.updateMany({
        where: {
          characterId,
          equippedSlot: metadata.equipmentSlot,
          NOT: { id: item.id },
        },
        data: { equippedSlot: null },
      });
      await transaction.inventoryItem.update({
        where: { id: item.id },
        data: { equippedSlot: metadata.equipmentSlot },
      });
      await this.progression.recomputeInTransaction(transaction, characterId);
    });
    return this.getInventory(userId, characterId);
  }

  override async unequip(
    userId: string,
    characterId: string,
    itemId: string,
  ): Promise<InventorySnapshot> {
    await this.database.$transaction(async (transaction) => {
      const item = await this.requireEquipment(transaction, userId, characterId, itemId);
      await this.progression.recomputeInTransaction(transaction, characterId);
      await transaction.inventoryItem.update({
        where: { id: item.id },
        data: { equippedSlot: null },
      });
      await this.progression.recomputeInTransaction(transaction, characterId);
    });
    return this.getInventory(userId, characterId);
  }

  private async requireEquipment(
    transaction: Prisma.TransactionClient,
    userId: string,
    characterId: string,
    itemId: string,
  ) {
    const item = await transaction.inventoryItem.findFirst({
      where: { id: itemId, characterId, character: { userId } },
      include: { itemDefinition: true, character: true },
    });
    if (!item) this.invalidItem();
    return item;
  }

  private equipmentMetadata(value: Prisma.JsonValue): EquipmentMetadata {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as EquipmentMetadata)
      : {};
  }

  private invalidItem(): never {
    throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
  }
}
