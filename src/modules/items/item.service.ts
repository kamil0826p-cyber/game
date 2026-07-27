import { Injectable } from '@nestjs/common';
import type { CharacterClass, EquipmentSlot, ItemCategory } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { InventorySnapshot, MerchantSnapshot } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';

export const INVENTORY_CAPACITY = 40;

type StatBonuses = Partial<Record<'strength' | 'agility' | 'intelligence' | 'armor' | 'maxHp' | 'maxEnergy', number>>;
type ItemMetadata = {
  category: ItemCategory;
  icon: string;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel?: number;
  effect?: { hp?: number; energy?: number };
  statBonuses?: StatBonuses;
  buyPriceSilver: number;
  sellPriceSilver: number;
  sellable?: boolean;
};
type CatalogDefinition = { key: string; name: string; description: string; stackLimit: number; metadata: ItemMetadata };
type CharacterStats = { strength: number; agility: number; intelligence: number; armor: number; maxHp: number; maxEnergy: number };

const CATALOG: readonly CatalogDefinition[] = [
  { key: 'traveler-sword', name: 'Traveler Sword', description: 'A dependable steel blade for a beginning warrior.', stackLimit: 1, metadata: { category: 'EQUIPMENT', icon: '⚔', equipmentSlot: 'MAIN_HAND', requiredClass: 'WARRIOR', statBonuses: { strength: 3 }, buyPriceSilver: 180, sellPriceSilver: 72 } },
  { key: 'apprentice-staff', name: 'Apprentice Staff', description: 'A simple focus for novice spellcasters.', stackLimit: 1, metadata: { category: 'EQUIPMENT', icon: '✦', equipmentSlot: 'MAIN_HAND', requiredClass: 'MAGE', statBonuses: { intelligence: 3, maxEnergy: 10 }, buyPriceSilver: 180, sellPriceSilver: 72 } },
  { key: 'field-bow', name: 'Field Bow', description: 'A light bow made for quick shots.', stackLimit: 1, metadata: { category: 'EQUIPMENT', icon: '➶', equipmentSlot: 'MAIN_HAND', requiredClass: 'ARCHER', statBonuses: { agility: 3 }, buyPriceSilver: 180, sellPriceSilver: 72 } },
  { key: 'minor-health-potion', name: 'Minor Health Potion', description: 'Restores 35 health.', stackLimit: 20, metadata: { category: 'CONSUMABLE', icon: '◆', effect: { hp: 35 }, buyPriceSilver: 24, sellPriceSilver: 9 } },
  { key: 'field-rations', name: 'Field Rations', description: 'Restores 30 energy.', stackLimit: 20, metadata: { category: 'CONSUMABLE', icon: '●', effect: { energy: 30 }, buyPriceSilver: 18, sellPriceSilver: 7 } },
  { key: 'town-scroll', name: 'Town Scroll', description: 'A dormant scroll prepared for a future travel system.', stackLimit: 10, metadata: { category: 'QUEST', icon: '▱', buyPriceSilver: 0, sellPriceSilver: 0, sellable: false } },
];

@Injectable()
export class ItemService {
  constructor(private readonly prisma: PrismaService) {}

  async getInventory(userId: string, characterId: string): Promise<InventorySnapshot> {
    await this.ensureCatalogAndRemoveLegacyStarterItems(userId, characterId);
    return this.snapshot(userId, characterId, true);
  }

  async getMerchant(userId: string, characterId: string): Promise<MerchantSnapshot> {
    await this.ensureCatalogAndRemoveLegacyStarterItems(userId, characterId);
    return this.merchantSnapshot(userId, characterId);
  }

  async buy(userId: string, characterId: string, itemKey: string, quantity: number, operationId: string): Promise<MerchantSnapshot> {
    this.assertQuantity(quantity);
    await this.prisma.$transaction(async (tx) => {
      const character = await this.requireCharacter(tx, userId, characterId);
      const merchant = await this.requireNearbyMerchant(tx, character);
      if (!merchant.itemKeys.includes(itemKey)) this.invalidItem();
      const definition = await tx.itemDefinition.findUnique({ where: { key: itemKey } });
      if (!definition) this.invalidItem();
      const metadata = this.metadata(definition.metadata);
      const total = metadata.buyPriceSilver * quantity;
      if (total <= 0) this.invalidItem();
      if (character.silver < total) throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver', { required: total, available: character.silver });
      await this.addToInventory(tx, characterId, definition.id, definition.stackLimit, quantity);
      const updated = await tx.character.update({ where: { id: characterId }, data: { silver: { decrement: total } }, select: { silver: true } });
      await tx.characterCurrencyLedger.create({ data: { characterId, operationId: `shop-buy:${operationId}`, currency: 'SILVER', direction: 'DEBIT', amount: total, reason: 'NPC_ITEM_PURCHASE', balanceAfter: updated.silver, metadata: { itemKey, quantity, unitPrice: metadata.buyPriceSilver, npcId: merchant.id } } });
    });
    return this.merchantSnapshot(userId, characterId);
  }

  async sell(userId: string, characterId: string, itemId: string, quantity: number, operationId: string): Promise<MerchantSnapshot> {
    this.assertQuantity(quantity);
    await this.prisma.$transaction(async (tx) => {
      const character = await this.requireCharacter(tx, userId, characterId);
      const merchant = await this.requireNearbyMerchant(tx, character);
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      if (item.equippedSlot) throw new GameError(GAME_ERROR_CODES.ITEM_EQUIPPED, 'errors.items.equipped');
      if (quantity > item.quantity) this.invalidItem();
      const metadata = this.metadata(item.itemDefinition.metadata);
      if (metadata.sellable === false || metadata.sellPriceSilver <= 0) throw new GameError(GAME_ERROR_CODES.ITEM_NOT_SELLABLE, 'errors.items.notSellable');
      const total = metadata.sellPriceSilver * quantity;
      if (quantity === item.quantity) await tx.inventoryItem.delete({ where: { id: item.id } });
      else await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: quantity } } });
      const updated = await tx.character.update({ where: { id: characterId }, data: { silver: { increment: total } }, select: { silver: true } });
      await tx.characterCurrencyLedger.create({ data: { characterId, operationId: `shop-sell:${operationId}`, currency: 'SILVER', direction: 'CREDIT', amount: total, reason: 'NPC_ITEM_SALE', balanceAfter: updated.silver, metadata: { itemKey: item.itemDefinition.key, quantity, unitPrice: metadata.sellPriceSilver, npcId: merchant.id } } });
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
    return this.snapshot(userId, characterId, true);
  }

  async equip(userId: string, characterId: string, itemId: string): Promise<InventorySnapshot> {
    await this.prisma.$transaction(async (tx) => {
      const item = await this.requireOwnedItem(tx, userId, characterId, itemId);
      const metadata = this.metadata(item.itemDefinition.metadata);
      if (metadata.category !== 'EQUIPMENT' || !metadata.equipmentSlot) this.invalidItem();
      if (metadata.requiredClass && metadata.requiredClass !== item.character.class) this.invalidItem();
      if ((metadata.minimumLevel ?? 1) > item.character.level) this.invalidItem();
      const base = await this.baseStatsBeforeEquipmentChange(tx, characterId);
      await tx.inventoryItem.updateMany({ where: { characterId, equippedSlot: metadata.equipmentSlot, NOT: { id: item.id } }, data: { equippedSlot: null } });
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
      const metadata = this.metadata(item.itemDefinition.metadata);
      if (metadata.category !== 'CONSUMABLE' || !metadata.effect) this.invalidItem();
      const hp = Math.min(item.character.maxHp, item.character.hp + (metadata.effect.hp ?? 0));
      const energy = Math.min(item.character.maxEnergy, item.character.energy + (metadata.effect.energy ?? 0));
      if (hp === item.character.hp && energy === item.character.energy) throw new GameError(GAME_ERROR_CODES.ITEM_EFFECT_NOT_NEEDED, 'errors.items.effectNotNeeded');
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
      if (item.equippedSlot) throw new GameError(GAME_ERROR_CODES.ITEM_EQUIPPED, 'errors.items.equipped');
      if (quantity > item.quantity) this.invalidItem();
      if (quantity === item.quantity) await tx.inventoryItem.delete({ where: { id: item.id } });
      else await tx.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: quantity } } });
    });
    return this.snapshot(userId, characterId, true);
  }

  private async ensureCatalogAndRemoveLegacyStarterItems(userId: string, characterId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const character = await tx.character.findFirst({ where: { id: characterId, userId }, select: { id: true } });
      if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      await this.upsertCatalog(tx);
      const legacy = await tx.inventoryItem.findMany({ where: { characterId }, select: { id: true, instanceData: true } });
      const legacyIds = legacy.filter((item) => (item.instanceData as { starter?: unknown } | null)?.starter === true).map((item) => item.id);
      if (legacyIds.length > 0) await tx.inventoryItem.deleteMany({ where: { id: { in: legacyIds } } });
    });
  }

  private async upsertCatalog(tx: Prisma.TransactionClient): Promise<void> {
    for (const definition of CATALOG) {
      await tx.itemDefinition.upsert({ where: { key: definition.key }, create: { key: definition.key, name: definition.name, description: definition.description, stackLimit: definition.stackLimit, metadata: definition.metadata as unknown as Prisma.InputJsonValue }, update: { name: definition.name, description: definition.description, stackLimit: definition.stackLimit, metadata: definition.metadata as unknown as Prisma.InputJsonValue } });
    }
  }

  private async merchantSnapshot(userId: string, characterId: string): Promise<MerchantSnapshot> {
    const character = await this.prisma.character.findFirst({ where: { id: characterId, userId }, select: { id: true, mapId: true, x: true, y: true, silver: true } });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    const merchant = await this.requireNearbyMerchant(this.prisma, character);
    const definitions = await this.prisma.itemDefinition.findMany({ where: { key: { in: merchant.itemKeys } }, orderBy: { key: 'asc' } });
    return { merchant: { id: merchant.id, key: merchant.key, name: merchant.name }, silver: character.silver, items: definitions.map((definition) => { const metadata = this.metadata(definition.metadata); return { definitionKey: definition.key, name: definition.name, description: definition.description, icon: metadata.icon, stackLimit: definition.stackLimit, buyPriceSilver: metadata.buyPriceSilver, sellPriceSilver: metadata.sellPriceSilver }; }), inventory: await this.snapshot(userId, characterId, true) };
  }

  private async snapshot(userId: string, characterId: string, includeCharacter = false): Promise<InventorySnapshot> {
    const character = await this.prisma.character.findFirst({ where: { id: characterId, userId }, select: { hp: true, maxHp: true, energy: true, maxEnergy: true, strength: true, agility: true, intelligence: true, armor: true, silver: true, inventoryItems: { orderBy: { slotIndex: 'asc' }, include: { itemDefinition: true } } } });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    return { capacity: INVENTORY_CAPACITY, silver: character.silver, items: character.inventoryItems.map((item) => { const metadata = this.metadata(item.itemDefinition.metadata); return { id: item.id, definitionKey: item.itemDefinition.key, name: item.itemDefinition.name, description: item.itemDefinition.description, category: metadata.category, icon: metadata.icon, quantity: item.quantity, stackLimit: item.itemDefinition.stackLimit, slotIndex: item.slotIndex, equippedSlot: item.equippedSlot ? item.equippedSlot as EquipmentSlot : undefined, equipmentSlot: metadata.equipmentSlot, requiredClass: metadata.requiredClass, minimumLevel: metadata.minimumLevel ?? 1, usable: metadata.category === 'CONSUMABLE', statBonuses: metadata.statBonuses ?? {}, buyPriceSilver: metadata.buyPriceSilver, sellPriceSilver: metadata.sellPriceSilver, sellable: metadata.sellable !== false && metadata.sellPriceSilver > 0 }; }), character: includeCharacter ? { hp: character.hp, maxHp: character.maxHp, energy: character.energy, maxEnergy: character.maxEnergy, strength: character.strength, agility: character.agility, intelligence: character.intelligence, armor: character.armor, silver: character.silver } : undefined };
  }

  private async baseStatsBeforeEquipmentChange(tx: Prisma.TransactionClient, characterId: string): Promise<CharacterStats> {
    const character = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { strength: true, agility: true, intelligence: true, armor: true, maxHp: true, maxEnergy: true, inventoryItems: { where: { equippedSlot: { not: null } }, include: { itemDefinition: true } } } });
    const bonuses = this.sumBonuses(character.inventoryItems.map((item) => this.metadata(item.itemDefinition.metadata).statBonuses));
    return { strength: character.strength - bonuses.strength, agility: character.agility - bonuses.agility, intelligence: character.intelligence - bonuses.intelligence, armor: character.armor - bonuses.armor, maxHp: character.maxHp - bonuses.maxHp, maxEnergy: character.maxEnergy - bonuses.maxEnergy };
  }

  private async applyEffectiveStats(tx: Prisma.TransactionClient, characterId: string, base: CharacterStats): Promise<void> {
    const equipped = await tx.inventoryItem.findMany({ where: { characterId, equippedSlot: { not: null } }, include: { itemDefinition: true } });
    const bonuses = this.sumBonuses(equipped.map((item) => this.metadata(item.itemDefinition.metadata).statBonuses));
    const maxHp = base.maxHp + bonuses.maxHp;
    const maxEnergy = base.maxEnergy + bonuses.maxEnergy;
    const current = await tx.character.findUniqueOrThrow({ where: { id: characterId }, select: { hp: true, energy: true } });
    await tx.character.update({ where: { id: characterId }, data: { strength: base.strength + bonuses.strength, agility: base.agility + bonuses.agility, intelligence: base.intelligence + bonuses.intelligence, armor: base.armor + bonuses.armor, maxHp, maxEnergy, hp: Math.min(current.hp, maxHp), energy: Math.min(current.energy, maxEnergy) } });
  }

  private sumBonuses(values: Array<StatBonuses | undefined>): Required<StatBonuses> {
    return values.reduce<Required<StatBonuses>>((sum, value) => ({ strength: sum.strength + (value?.strength ?? 0), agility: sum.agility + (value?.agility ?? 0), intelligence: sum.intelligence + (value?.intelligence ?? 0), armor: sum.armor + (value?.armor ?? 0), maxHp: sum.maxHp + (value?.maxHp ?? 0), maxEnergy: sum.maxEnergy + (value?.maxEnergy ?? 0) }), { strength: 0, agility: 0, intelligence: 0, armor: 0, maxHp: 0, maxEnergy: 0 });
  }

  private async addToInventory(tx: Prisma.TransactionClient, characterId: string, itemDefinitionId: string, stackLimit: number, quantity: number): Promise<void> {
    let remaining = quantity;
    const stacks = await tx.inventoryItem.findMany({ where: { characterId, itemDefinitionId, equippedSlot: null, quantity: { lt: stackLimit } }, orderBy: { slotIndex: 'asc' } });
    for (const stack of stacks) { const moved = Math.min(remaining, stackLimit - stack.quantity); await tx.inventoryItem.update({ where: { id: stack.id }, data: { quantity: { increment: moved } } }); remaining -= moved; if (remaining === 0) return; }
    const occupied = new Set((await tx.inventoryItem.findMany({ where: { characterId }, select: { slotIndex: true } })).map((item) => item.slotIndex));
    for (let slotIndex = 0; slotIndex < INVENTORY_CAPACITY && remaining > 0; slotIndex += 1) { if (occupied.has(slotIndex)) continue; const amount = Math.min(remaining, stackLimit); await tx.inventoryItem.create({ data: { characterId, itemDefinitionId, quantity: amount, slotIndex } }); remaining -= amount; }
    if (remaining > 0) throw new GameError(GAME_ERROR_CODES.INVENTORY_FULL, 'errors.items.inventoryFull');
  }

  private async requireCharacter(tx: Prisma.TransactionClient, userId: string, characterId: string) {
    const character = await tx.character.findFirst({ where: { id: characterId, userId }, select: { id: true, mapId: true, x: true, y: true, silver: true } });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    return character;
  }

  private async requireNearbyMerchant(tx: Pick<Prisma.TransactionClient, 'npcDefinition'>, character: { mapId: string; x: number; y: number }) {
    const npcs = await tx.npcDefinition.findMany({ where: { mapId: character.mapId } });
    for (const npc of npcs) {
      const dialogue = npc.dialogue as { merchant?: { itemKeys?: unknown; interactionRadius?: unknown } } | null;
      const itemKeys = Array.isArray(dialogue?.merchant?.itemKeys) ? dialogue.merchant.itemKeys.filter((key): key is string => typeof key === 'string') : [];
      const radius = typeof dialogue?.merchant?.interactionRadius === 'number' ? dialogue.merchant.interactionRadius : 2;
      if (itemKeys.length > 0 && Math.max(Math.abs(npc.x - character.x), Math.abs(npc.y - character.y)) <= radius) return { ...npc, itemKeys };
    }
    throw new GameError(GAME_ERROR_CODES.MERCHANT_NOT_AVAILABLE, 'errors.items.merchantUnavailable');
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
