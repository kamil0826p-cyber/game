import { Injectable } from '@nestjs/common';
import type { CharacterClass, EquipmentSlot, ItemCategory } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { InventorySnapshot } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const INVENTORY_CAPACITY = 40;

type ItemMetadata = {
  category: ItemCategory;
  icon: string;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel?: number;
  effect?: { hp?: number; energy?: number };
};

const CATALOG = [
  { key: 'traveler-sword', name: 'Traveler Sword', description: 'A dependable steel blade for a beginning warrior.', stackLimit: 1, metadata: { category: 'EQUIPMENT', icon: '⚔', equipmentSlot: 'MAIN_HAND', requiredClass: 'WARRIOR' } },
  { key: 'apprentice-staff', name: 'Apprentice Staff', description: 'A simple focus for novice spellcasters.', stackLimit: 1, metadata: { category: 'EQUIPMENT', icon: '✦', equipmentSlot: 'MAIN_HAND', requiredClass: 'MAGE' } },
  { key: 'field-bow', name: 'Field Bow', description: 'A light bow made for quick shots.', stackLimit: 1, metadata: { category: 'EQUIPMENT', icon: '➶', equipmentSlot: 'MAIN_HAND', requiredClass: 'ARCHER' } },
  { key: 'minor-health-potion', name: 'Minor Health Potion', description: 'Restores 35 health.', stackLimit: 20, metadata: { category: 'CONSUMABLE', icon: '◆', effect: { hp: 35 } } },
  { key: 'field-rations', name: 'Field Rations', description: 'Restores 30 energy.', stackLimit: 20, metadata: { category: 'CONSUMABLE', icon: '●', effect: { energy: 30 } } },
  { key: 'town-scroll', name: 'Town Scroll', description: 'A dormant scroll prepared for a future travel system.', stackLimit: 10, metadata: { category: 'QUEST', icon: '▱' } },
] as const;

@Injectable()
export class ItemService {
  constructor(private readonly prisma: PrismaService) {}

  async getInventory(userId: string, characterId: string): Promise<InventorySnapshot> {
    await this.ensureStarterInventory(userId, characterId);
    return this.snapshot(userId, characterId);
  }

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
      if (source.itemDefinitionId === target.itemDefinitionId && !source.equippedSlot && !target.equippedSlot && target.quantity < target.itemDefinition.stackLimit) {
        const moved = Math.min(source.quantity, target.itemDefinition.stackLimit - target.quantity);
        await tx.inventoryItem.update({ where: { id: target.id }, data: { quantity: { increment: moved } } });
        if (moved === source.quantity) await tx.inventoryItem.delete({ where: { id: source.id } });
        else await tx.inventoryItem.update({ where: { id: source.id }, data: { quantity: { decrement: moved } } });
        return;
      }
      await tx.inventoryItem.update({ where: { id: source.id }, data: { slotIndex: -1 } });
      await tx.inventoryItem.update({ where: { id: target.id }, data: { slotIndex: source.slotIndex } });
      await tx.inventoryItem.update({ where: { id: source.id }, data: { slotIndex: targetSlotIndex } });
    });
    return this.snapshot(userId, characterId);
  }

  async equip(userId: string, characterId: string, itemId: string): Promise<InventorySnapshot> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      const metadata = this.metadata(item.itemDefinition.metadata);
      if (metadata.category !== 'EQUIPMENT' || !metadata.equipmentSlot) this.invalidItem();
      if (metadata.requiredClass && metadata.requiredClass !== item.character.class) this.invalidItem();
      if ((metadata.minimumLevel ?? 1) > item.character.level) this.invalidItem();
      await tx.inventoryItem.updateMany({
        where: { characterId, equippedSlot: metadata.equipmentSlot, NOT: { id: item.id } },
        data: { equippedSlot: null },
      });
      await tx.inventoryItem.update({ where: { id: item.id }, data: { equippedSlot: metadata.equipmentSlot } });
    });
    return this.snapshot(userId, characterId);
  }

  async unequip(userId: string, characterId: string, itemId: string): Promise<InventorySnapshot> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      await tx.inventoryItem.update({ where: { id: item.id }, data: { equippedSlot: null } });
    });
    return this.snapshot(userId, characterId);
  }

  async use(userId: string, characterId: string, itemId: string): Promise<InventorySnapshot> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      const metadata = this.metadata(item.itemDefinition.metadata);
      if (metadata.category !== 'CONSUMABLE' || !metadata.effect) this.invalidItem();
      const hp = Math.min(item.character.maxHp, item.character.hp + (metadata.effect.hp ?? 0));
      const energy = Math.min(item.character.maxEnergy, item.character.energy + (metadata.effect.energy ?? 0));
      if (hp === item.character.hp && energy === item.character.energy) this.invalidItem();
      await tx.character.update({ where: { id: characterId }, data: { hp, energy } });
      if (item.quantity === 1) await tx.inventoryItem.delete({ where: { id: item.id } });
      else await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: 1 } } });
    });
    return this.snapshot(userId, characterId, true);
  }

  async discard(userId: string, characterId: string, itemId: string, quantity: number): Promise<InventorySnapshot> {
    if (!Number.isInteger(quantity) || quantity < 1) this.invalidItem();
    await this.prisma.$transaction(async (tx) => {
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      if (quantity > item.quantity) this.invalidItem();
      if (quantity === item.quantity) await tx.inventoryItem.delete({ where: { id: item.id } });
      else await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: quantity } } });
    });
    return this.snapshot(userId, characterId);
  }

  private async ensureStarterInventory(userId: string, characterId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findFirst({ where: { id: characterId, userId }, select: { class: true, createdAt: true } });
      if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      if (await tx.inventoryItem.count({ where: { characterId } })) return;
      const definitions = new Map<string, string>();
      for (const definition of CATALOG) {
        const record = await tx.itemDefinition.upsert({
          where: { key: definition.key },
          create: { key: definition.key, name: definition.name, description: definition.description, stackLimit: definition.stackLimit, metadata: definition.metadata as unknown as Prisma.InputJsonValue },
          update: { name: definition.name, description: definition.description, stackLimit: definition.stackLimit, metadata: definition.metadata as unknown as Prisma.InputJsonValue },
          select: { id: true, key: true },
        });
        definitions.set(record.key, record.id);
      }
      const weaponKey = character.class === 'MAGE' ? 'apprentice-staff' : character.class === 'ARCHER' ? 'field-bow' : 'traveler-sword';
      await tx.inventoryItem.createMany({ data: [
        { characterId, itemDefinitionId: definitions.get(weaponKey)!, quantity: 1, slotIndex: 0 },
        { characterId, itemDefinitionId: definitions.get('minor-health-potion')!, quantity: 5, slotIndex: 1 },
        { characterId, itemDefinitionId: definitions.get('field-rations')!, quantity: 3, slotIndex: 2 },
        { characterId, itemDefinitionId: definitions.get('town-scroll')!, quantity: 1, slotIndex: 3 },
      ] });
    });
  }

  private async snapshot(userId: string, characterId: string, includeCharacter = false): Promise<InventorySnapshot> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, userId },
      select: { hp: true, maxHp: true, energy: true, maxEnergy: true, inventoryItems: { orderBy: { slotIndex: 'asc' }, include: { itemDefinition: true } } },
    });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    return {
      capacity: INVENTORY_CAPACITY,
      items: character.inventoryItems.map((item) => {
        const metadata = this.metadata(item.itemDefinition.metadata);
        return {
          id: item.id,
          definitionKey: item.itemDefinition.key,
          name: item.itemDefinition.name,
          description: item.itemDefinition.description,
          category: metadata.category,
          icon: metadata.icon,
          quantity: item.quantity,
          stackLimit: item.itemDefinition.stackLimit,
          slotIndex: item.slotIndex,
          equippedSlot: item.equippedSlot ? (item.equippedSlot as EquipmentSlot) : undefined,
          equipmentSlot: metadata.equipmentSlot,
          requiredClass: metadata.requiredClass,
          minimumLevel: metadata.minimumLevel ?? 1,
          usable: metadata.category === 'CONSUMABLE',
        };
      }),
      character: includeCharacter ? { hp: character.hp, maxHp: character.maxHp, energy: character.energy, maxEnergy: character.maxEnergy } : undefined,
    };
  }

  private async requireOwnedItem(tx: Prisma.TransactionClient, userId: string, characterId: string, itemId: string) {
    const item = await tx.inventoryItem.findFirst({ where: { id: itemId, characterId, character: { userId } }, include: { itemDefinition: true, character: true } });
    if (!item) this.invalidItem();
    return item;
  }

  private metadata(value: Prisma.JsonValue): ItemMetadata {
    const metadata = value as unknown as Partial<ItemMetadata>;
    if (!metadata.category || !metadata.icon) this.invalidItem();
    return metadata as ItemMetadata;
  }

  private assertSlot(slotIndex: number): void {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= INVENTORY_CAPACITY) this.invalidItem();
  }

  private invalidItem(): never {
    throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
  }
}
