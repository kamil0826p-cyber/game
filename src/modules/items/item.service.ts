import { Injectable } from '@nestjs/common';
import type { CharacterClass, EquipmentSlot, ItemCategory } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { InventorySnapshot, MerchantSnapshot } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const INVENTORY_CAPACITY = 40;
const MERCHANT_KEY = 'quartermaster';
const MERCHANT_RADIUS = 3;

type ItemMetadata = {
  category: ItemCategory;
  icon: string;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel?: number;
  effect?: { hp?: number; energy?: number };
  buyPriceSilver: number;
  sellPriceSilver: number;
  sellable?: boolean;
};

type CatalogDefinition = {
  key: string;
  name: string;
  description: string;
  stackLimit: number;
  metadata: ItemMetadata;
};

const CATALOG: readonly CatalogDefinition[] = [
  { key: 'traveler-sword', name: 'Traveler Sword', description: 'A dependable steel blade for a beginning warrior.', stackLimit: 1, metadata: { category: 'EQUIPMENT', icon: '⚔', equipmentSlot: 'MAIN_HAND', requiredClass: 'WARRIOR', buyPriceSilver: 180, sellPriceSilver: 72 } },
  { key: 'apprentice-staff', name: 'Apprentice Staff', description: 'A simple focus for novice spellcasters.', stackLimit: 1, metadata: { category: 'EQUIPMENT', icon: '✦', equipmentSlot: 'MAIN_HAND', requiredClass: 'MAGE', buyPriceSilver: 180, sellPriceSilver: 72 } },
  { key: 'field-bow', name: 'Field Bow', description: 'A light bow made for quick shots.', stackLimit: 1, metadata: { category: 'EQUIPMENT', icon: '➶', equipmentSlot: 'MAIN_HAND', requiredClass: 'ARCHER', buyPriceSilver: 180, sellPriceSilver: 72 } },
  { key: 'minor-health-potion', name: 'Minor Health Potion', description: 'Restores 35 health.', stackLimit: 20, metadata: { category: 'CONSUMABLE', icon: '◆', effect: { hp: 35 }, buyPriceSilver: 24, sellPriceSilver: 9 } },
  { key: 'field-rations', name: 'Field Rations', description: 'Restores 30 energy.', stackLimit: 20, metadata: { category: 'CONSUMABLE', icon: '●', effect: { energy: 30 }, buyPriceSilver: 18, sellPriceSilver: 7 } },
  { key: 'town-scroll', name: 'Town Scroll', description: 'A dormant scroll prepared for a future travel system.', stackLimit: 10, metadata: { category: 'QUEST', icon: '▱', buyPriceSilver: 0, sellPriceSilver: 0, sellable: false } },
];

const MERCHANT_STOCK = CATALOG.filter((item) => item.metadata.buyPriceSilver > 0).map((item) => item.key);

@Injectable()
export class ItemService {
  constructor(private readonly prisma: PrismaService) {}

  async getInventory(userId: string, characterId: string): Promise<InventorySnapshot> {
    await this.ensureStarterInventory(userId, characterId);
    return this.snapshot(userId, characterId);
  }

  async getMerchant(userId: string, characterId: string): Promise<MerchantSnapshot> {
    await this.ensureStarterInventory(userId, characterId);
    await this.ensureMerchant(userId, characterId);
    return this.merchantSnapshot(userId, characterId);
  }

  async buy(userId: string, characterId: string, itemKey: string, quantity: number, operationId: string): Promise<MerchantSnapshot> {
    this.assertQuantity(quantity);
    await this.prisma.$transaction(async (tx) => {
      const character = await this.requireCharacter(tx, userId, characterId);
      await this.requireNearbyMerchant(tx, character);
      if (!MERCHANT_STOCK.includes(itemKey)) this.invalidItem();
      const definition = await tx.itemDefinition.findUnique({ where: { key: itemKey } });
      if (!definition) this.invalidItem();
      const metadata = this.metadata(definition.metadata);
      const total = metadata.buyPriceSilver * quantity;
      if (total <= 0) this.invalidItem();
      if (character.silver < total) throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver', { required: total, available: character.silver });
      await this.addToInventory(tx, characterId, definition.id, definition.stackLimit, quantity);
      const updated = await tx.character.update({ where: { id: characterId }, data: { silver: { decrement: total } }, select: { silver: true } });
      await tx.characterCurrencyLedger.create({ data: { characterId, operationId: `shop-buy:${operationId}`, currency: 'SILVER', direction: 'DEBIT', amount: total, reason: 'NPC_ITEM_PURCHASE', balanceAfter: updated.silver, metadata: { itemKey, quantity, unitPrice: metadata.buyPriceSilver } } });
    });
    return this.merchantSnapshot(userId, characterId);
  }

  async sell(userId: string, characterId: string, itemId: string, quantity: number, operationId: string): Promise<MerchantSnapshot> {
    this.assertQuantity(quantity);
    await this.prisma.$transaction(async (tx) => {
      const character = await this.requireCharacter(tx, userId, characterId);
      await this.requireNearbyMerchant(tx, character);
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      if (item.equippedSlot) throw new GameError(GAME_ERROR_CODES.ITEM_EQUIPPED, 'errors.items.equipped');
      if (quantity > item.quantity) this.invalidItem();
      const metadata = this.metadata(item.itemDefinition.metadata);
      if (metadata.sellable === false || metadata.sellPriceSilver <= 0) throw new GameError(GAME_ERROR_CODES.ITEM_NOT_SELLABLE, 'errors.items.notSellable');
      const total = metadata.sellPriceSilver * quantity;
      if (quantity === item.quantity) await tx.inventoryItem.delete({ where: { id: item.id } });
      else await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: quantity } } });
      const updated = await tx.character.update({ where: { id: characterId }, data: { silver: { increment: total } }, select: { silver: true } });
      await tx.characterCurrencyLedger.create({ data: { characterId, operationId: `shop-sell:${operationId}`, currency: 'SILVER', direction: 'CREDIT', amount: total, reason: 'NPC_ITEM_SALE', balanceAfter: updated.silver, metadata: { itemKey: item.itemDefinition.key, quantity, unitPrice: metadata.sellPriceSilver } } });
    });
    return this.merchantSnapshot(userId, characterId);
  }

  async move(userId: string, characterId: string, itemId: string, targetSlotIndex: number): Promise<InventorySnapshot> {
    this.assertSlot(targetSlotIndex);
    await this.prisma.$transaction(async (tx) => {
      const source = await this.requireOwnedItem(tx, userId, characterId, itemId);
      if (source.slotIndex === targetSlotIndex) return;
      const target = await tx.inventoryItem.findUnique({ where: { characterId_slotIndex: { characterId, slotIndex: targetSlotIndex } }, include: { itemDefinition: true } });
      if (!target) { await tx.inventoryItem.update({ where: { id: source.id }, data: { slotIndex: targetSlotIndex } }); return; }
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
      await tx.inventoryItem.updateMany({ where: { characterId, equippedSlot: metadata.equipmentSlot, NOT: { id: item.id } }, data: { equippedSlot: null } });
      await tx.inventoryItem.update({ where: { id: item.id }, data: { equippedSlot: metadata.equipmentSlot } });
    });
    return this.snapshot(userId, characterId);
  }

  async unequip(userId: string, characterId: string, itemId: string): Promise<InventorySnapshot> {
    await this.prisma.$transaction(async (tx) => { const item = await this.requireOwnedItem(tx, userId, characterId, itemId); await tx.inventoryItem.update({ where: { id: item.id }, data: { equippedSlot: null } }); });
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
    this.assertQuantity(quantity);
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
      const character = await tx.character.findFirst({ where: { id: characterId, userId }, select: { class: true } });
      if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      const definitions = await this.upsertCatalog(tx);
      if (await tx.inventoryItem.count({ where: { characterId } })) return;
      const weaponKey = character.class === 'MAGE' ? 'apprentice-staff' : character.class === 'ARCHER' ? 'field-bow' : 'traveler-sword';
      await tx.inventoryItem.createMany({ data: [
        { characterId, itemDefinitionId: definitions.get(weaponKey)!, quantity: 1, slotIndex: 0, instanceData: { starter: true } },
        { characterId, itemDefinitionId: definitions.get('minor-health-potion')!, quantity: 5, slotIndex: 1, instanceData: { starter: true } },
        { characterId, itemDefinitionId: definitions.get('field-rations')!, quantity: 3, slotIndex: 2, instanceData: { starter: true } },
        { characterId, itemDefinitionId: definitions.get('town-scroll')!, quantity: 1, slotIndex: 3, instanceData: { starter: true } },
      ] });
    });
  }

  private async upsertCatalog(tx: Prisma.TransactionClient): Promise<Map<string, string>> {
    const definitions = new Map<string, string>();
    for (const definition of CATALOG) {
      const record = await tx.itemDefinition.upsert({ where: { key: definition.key }, create: { key: definition.key, name: definition.name, description: definition.description, stackLimit: definition.stackLimit, metadata: definition.metadata as unknown as Prisma.InputJsonValue }, update: { name: definition.name, description: definition.description, stackLimit: definition.stackLimit, metadata: definition.metadata as unknown as Prisma.InputJsonValue }, select: { id: true, key: true } });
      definitions.set(record.key, record.id);
    }
    return definitions;
  }

  private async ensureMerchant(userId: string, characterId: string): Promise<void> {
    const character = await this.prisma.character.findFirst({ where: { id: characterId, userId }, select: { mapId: true, map: { select: { spawnX: true, spawnY: true } } } });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    await this.prisma.npcDefinition.upsert({ where: { mapId_key: { mapId: character.mapId, key: MERCHANT_KEY } }, create: { mapId: character.mapId, key: MERCHANT_KEY, name: 'Quartermaster', x: character.map.spawnX + 1, y: character.map.spawnY, outfitKey: 'npc-quartermaster', dialogue: { merchant: { itemKeys: MERCHANT_STOCK, interactionRadius: MERCHANT_RADIUS } } }, update: { name: 'Quartermaster', dialogue: { merchant: { itemKeys: MERCHANT_STOCK, interactionRadius: MERCHANT_RADIUS } } } });
  }

  private async merchantSnapshot(userId: string, characterId: string): Promise<MerchantSnapshot> {
    const character = await this.prisma.character.findFirst({ where: { id: characterId, userId }, select: { id: true, mapId: true, x: true, y: true, silver: true } });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    const merchant = await this.requireNearbyMerchant(this.prisma, character);
    const definitions = await this.prisma.itemDefinition.findMany({ where: { key: { in: MERCHANT_STOCK } }, orderBy: { key: 'asc' } });
    return { merchant: { id: merchant.id, key: merchant.key, name: merchant.name }, silver: character.silver, items: definitions.map((definition) => { const metadata = this.metadata(definition.metadata); return { definitionKey: definition.key, name: definition.name, description: definition.description, icon: metadata.icon, stackLimit: definition.stackLimit, buyPriceSilver: metadata.buyPriceSilver, sellPriceSilver: metadata.sellPriceSilver }; }), inventory: await this.snapshot(userId, characterId) };
  }

  private async snapshot(userId: string, characterId: string, includeCharacter = false): Promise<InventorySnapshot> {
    const character = await this.prisma.character.findFirst({ where: { id: characterId, userId }, select: { hp: true, maxHp: true, energy: true, maxEnergy: true, silver: true, inventoryItems: { orderBy: { slotIndex: 'asc' }, include: { itemDefinition: true } } } });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    return { capacity: INVENTORY_CAPACITY, silver: character.silver, items: character.inventoryItems.map((item) => { const metadata = this.metadata(item.itemDefinition.metadata); return { id: item.id, definitionKey: item.itemDefinition.key, name: item.itemDefinition.name, description: item.itemDefinition.description, category: metadata.category, icon: metadata.icon, quantity: item.quantity, stackLimit: item.itemDefinition.stackLimit, slotIndex: item.slotIndex, equippedSlot: item.equippedSlot ? item.equippedSlot as EquipmentSlot : undefined, equipmentSlot: metadata.equipmentSlot, requiredClass: metadata.requiredClass, minimumLevel: metadata.minimumLevel ?? 1, usable: metadata.category === 'CONSUMABLE', buyPriceSilver: metadata.buyPriceSilver, sellPriceSilver: metadata.sellPriceSilver, sellable: metadata.sellable !== false && metadata.sellPriceSilver > 0 }; }), character: includeCharacter ? { hp: character.hp, maxHp: character.maxHp, energy: character.energy, maxEnergy: character.maxEnergy } : undefined };
  }

  private async addToInventory(tx: Prisma.TransactionClient, characterId: string, itemDefinitionId: string, stackLimit: number, quantity: number): Promise<void> {
    let remaining = quantity;
    const stacks = await tx.inventoryItem.findMany({ where: { characterId, itemDefinitionId, equippedSlot: null, quantity: { lt: stackLimit } }, orderBy: { slotIndex: 'asc' } });
    for (const stack of stacks) {
      const moved = Math.min(remaining, stackLimit - stack.quantity);
      await tx.inventoryItem.update({ where: { id: stack.id }, data: { quantity: { increment: moved } } });
      remaining -= moved;
      if (remaining === 0) return;
    }
    const occupied = new Set((await tx.inventoryItem.findMany({ where: { characterId }, select: { slotIndex: true } })).map((item) => item.slotIndex));
    for (let slotIndex = 0; slotIndex < INVENTORY_CAPACITY && remaining > 0; slotIndex += 1) {
      if (occupied.has(slotIndex)) continue;
      const amount = Math.min(remaining, stackLimit);
      await tx.inventoryItem.create({ data: { characterId, itemDefinitionId, quantity: amount, slotIndex } });
      remaining -= amount;
    }
    if (remaining > 0) throw new GameError(GAME_ERROR_CODES.INVENTORY_FULL, 'errors.items.inventoryFull');
  }

  private async requireCharacter(tx: Prisma.TransactionClient, userId: string, characterId: string) {
    const character = await tx.character.findFirst({ where: { id: characterId, userId }, select: { id: true, mapId: true, x: true, y: true, silver: true } });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    return character;
  }

  private async requireNearbyMerchant(tx: Pick<Prisma.TransactionClient, 'npcDefinition'>, character: { mapId: string; x: number; y: number }) {
    const merchants = await tx.npcDefinition.findMany({ where: { mapId: character.mapId, key: MERCHANT_KEY } });
    const merchant = merchants.find((npc) => Math.max(Math.abs(npc.x - character.x), Math.abs(npc.y - character.y)) <= MERCHANT_RADIUS);
    if (!merchant) throw new GameError(GAME_ERROR_CODES.MERCHANT_NOT_AVAILABLE, 'errors.items.merchantUnavailable');
    return merchant;
  }

  private async requireOwnedItem(tx: Prisma.TransactionClient, userId: string, characterId: string, itemId: string) {
    const item = await tx.inventoryItem.findFirst({ where: { id: itemId, characterId, character: { userId } }, include: { itemDefinition: true, character: true } });
    if (!item) this.invalidItem();
    return item;
  }

  private metadata(value: Prisma.JsonValue): ItemMetadata {
    const metadata = value as unknown as Partial<ItemMetadata>;
    if (!metadata.category || !metadata.icon || !Number.isInteger(metadata.buyPriceSilver) || !Number.isInteger(metadata.sellPriceSilver)) this.invalidItem();
    return metadata as ItemMetadata;
  }

  private assertSlot(slotIndex: number): void { if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= INVENTORY_CAPACITY) this.invalidItem(); }
  private assertQuantity(quantity: number): void { if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) this.invalidItem(); }
  private invalidItem(): never { throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid'); }
}
