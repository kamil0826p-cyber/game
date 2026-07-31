import type { CharacterClass, EquipmentSlot, ItemCategory } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { isActorWithinInteractionRange } from '../../common/rules/actor-interaction.js';
import {
  readContentSnapshot,
  stampContentSnapshot,
} from '../../content/content-instance-version.js';
import { CURRENT_CONTENT_VERSION } from '../../content/current-content.js';
import type { InventorySnapshot, ItemRarity, MerchantSnapshot } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import { DomainEventService } from '../../domain-events/domain-event.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { parseNpcDialogueDefinition } from '../npcs/npc-dialogue.js';

export const INVENTORY_CAPACITY = 40;

type StatBonuses = Partial<Record<'strength' | 'agility' | 'intelligence' | 'armor' | 'maxHp' | 'maxEnergy', number>>;
type ItemMetadata = {
  category: ItemCategory;
  rarity: ItemRarity;
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
type CharacterStats = { strength: number; agility: number; intelligence: number; armor: number; maxHp: number; maxEnergy: number };
type ItemDefinitionView = {
  key: string;
  name: string;
  description: string;
  stackLimit: number;
  metadata: Prisma.JsonValue;
};
type InventoryRecord = {
  id: string;
  itemDefinitionId: string;
  quantity: number;
  slotIndex: number;
  equippedSlot: string | null;
  instanceData: Prisma.JsonValue;
  itemDefinition: ItemDefinitionView & { id?: string };
  character?: any;
};


export class ItemServiceBase {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly domainEvents: DomainEventService,
  ) {}

  getInventory(userId: string, characterId: string): Promise<InventorySnapshot> {
    return this.snapshot(userId, characterId, true);
  }

  getMerchant(userId: string, characterId: string, npcId: string): Promise<MerchantSnapshot> {
    return this.merchantSnapshot(userId, characterId, npcId);
  }


  protected async merchantSnapshot(userId: string, characterId: string, npcId: string): Promise<MerchantSnapshot> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true, mapId: true, x: true, y: true, silver: true },
    });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    const merchant = await this.requireMerchant(this.prisma, character, npcId);
    const definitions = await this.prisma.itemDefinition.findMany({ where: { key: { in: merchant.itemKeys } } }) as Array<ItemDefinitionView & { id: string }>;
    const definitionsByKey = new Map<string, ItemDefinitionView>(definitions.map((definition: ItemDefinitionView) => [definition.key, definition]));
    return {
      merchant: { id: merchant.id, key: merchant.key, name: merchant.name },
      silver: character.silver,
      items: (merchant.itemKeys as string[]).flatMap((itemKey: string) => {
        const definition = definitionsByKey.get(itemKey);
        if (!definition) return [];
        const metadata = this.metadata(definition.metadata);
        return [{
          definitionKey: definition.key,
          name: definition.name,
          description: definition.description,
          category: metadata.category,
          rarity: metadata.rarity,
          icon: metadata.icon,
          stackLimit: definition.stackLimit,
          equipmentSlot: metadata.equipmentSlot,
          requiredClass: metadata.requiredClass,
          minimumLevel: metadata.minimumLevel ?? 1,
          statBonuses: metadata.statBonuses ?? {},
          effect: metadata.effect,
          buyPriceSilver: metadata.buyPriceSilver,
          sellPriceSilver: metadata.sellPriceSilver,
        }];
      }),
      inventory: await this.snapshot(userId, characterId, true),
    };
  }

  protected async snapshot(userId: string, characterId: string, includeCharacter = false): Promise<InventorySnapshot> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, userId },
      select: {
        hp: true,
        maxHp: true,
        energy: true,
        maxEnergy: true,
        strength: true,
        agility: true,
        intelligence: true,
        armor: true,
        silver: true,
        inventoryItems: { orderBy: { slotIndex: 'asc' }, include: { itemDefinition: true } },
      },
    });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    return {
      capacity: INVENTORY_CAPACITY,
      silver: character.silver,
      items: (character.inventoryItems as InventoryRecord[]).map((item: InventoryRecord) => {
        const view = this.itemView(item);
        const metadata = this.metadata(view.metadata);
        return {
          id: item.id,
          definitionKey: view.key,
          name: view.name,
          description: view.description,
          category: metadata.category,
          rarity: metadata.rarity,
          icon: metadata.icon,
          quantity: item.quantity,
          stackLimit: view.stackLimit,
          slotIndex: item.slotIndex,
          equippedSlot: item.equippedSlot ? item.equippedSlot as EquipmentSlot : undefined,
          equipmentSlot: metadata.equipmentSlot,
          requiredClass: metadata.requiredClass,
          minimumLevel: metadata.minimumLevel ?? 1,
          usable: metadata.category === 'CONSUMABLE',
          statBonuses: metadata.statBonuses ?? {},
          effect: metadata.effect,
          buyPriceSilver: metadata.buyPriceSilver,
          sellPriceSilver: metadata.sellPriceSilver,
          sellable: metadata.sellable !== false && metadata.sellPriceSilver > 0,
        };
      }),
      character: includeCharacter ? {
        hp: character.hp,
        maxHp: character.maxHp,
        energy: character.energy,
        maxEnergy: character.maxEnergy,
        strength: character.strength,
        agility: character.agility,
        intelligence: character.intelligence,
        armor: character.armor,
        silver: character.silver,
      } : undefined,
    };
  }

  protected async baseStatsBeforeEquipmentChange(tx: Prisma.TransactionClient, characterId: string): Promise<CharacterStats> {
    const character = await tx.character.findUniqueOrThrow({
      where: { id: characterId },
      select: {
        strength: true,
        agility: true,
        intelligence: true,
        armor: true,
        maxHp: true,
        maxEnergy: true,
        inventoryItems: { where: { equippedSlot: { not: null } }, include: { itemDefinition: true } },
      },
    });
    const bonuses = this.sumBonuses((character.inventoryItems as InventoryRecord[]).map((item: InventoryRecord) =>
      this.metadata(this.itemView(item).metadata).statBonuses));
    return {
      strength: character.strength - bonuses.strength,
      agility: character.agility - bonuses.agility,
      intelligence: character.intelligence - bonuses.intelligence,
      armor: character.armor - bonuses.armor,
      maxHp: character.maxHp - bonuses.maxHp,
      maxEnergy: character.maxEnergy - bonuses.maxEnergy,
    };
  }

  protected async applyEffectiveStats(tx: Prisma.TransactionClient, characterId: string, base: CharacterStats): Promise<void> {
    const equipped = await tx.inventoryItem.findMany({
      where: { characterId, equippedSlot: { not: null } },
      include: { itemDefinition: true },
    });
    const bonuses = this.sumBonuses((equipped as InventoryRecord[]).map((item: InventoryRecord) =>
      this.metadata(this.itemView(item).metadata).statBonuses));
    const maxHp = base.maxHp + bonuses.maxHp;
    const maxEnergy = base.maxEnergy + bonuses.maxEnergy;
    const current = await tx.character.findUniqueOrThrow({
      where: { id: characterId },
      select: { hp: true, energy: true },
    });
    await tx.character.update({
      where: { id: characterId },
      data: {
        strength: base.strength + bonuses.strength,
        agility: base.agility + bonuses.agility,
        intelligence: base.intelligence + bonuses.intelligence,
        armor: base.armor + bonuses.armor,
        maxHp,
        maxEnergy,
        hp: Math.min(current.hp, maxHp),
        energy: Math.min(current.energy, maxEnergy),
      },
    });
  }

  protected sumBonuses(values: Array<StatBonuses | undefined>): Required<StatBonuses> {
    return values.reduce<Required<StatBonuses>>((sum, value) => ({
      strength: sum.strength + (value?.strength ?? 0),
      agility: sum.agility + (value?.agility ?? 0),
      intelligence: sum.intelligence + (value?.intelligence ?? 0),
      armor: sum.armor + (value?.armor ?? 0),
      maxHp: sum.maxHp + (value?.maxHp ?? 0),
      maxEnergy: sum.maxEnergy + (value?.maxEnergy ?? 0),
    }), { strength: 0, agility: 0, intelligence: 0, armor: 0, maxHp: 0, maxEnergy: 0 });
  }

  protected async addToInventory(
    tx: Prisma.TransactionClient,
    characterId: string,
    itemDefinitionId: string,
    stackLimit: number;,
    quantity: number,
    instanceData: Prisma.InputJsonValue,
  ): Promise<void> {
    let remaining = quantity;
    const stacks = await tx.inventoryItem.findMany({
      where: { characterId, itemDefinitionId, equippedSlot: null, quantity: { lt: stackLimit } },
      orderBy: { slotIndex: 'asc' },
    });
    for (const stack of stacks) {
      if (JSON.stringify(stack.instanceData) !== JSON.stringify(instanceData)) continue;
      const moved = Math.min(remaining, stackLimit - stack.quantity);
      await tx.inventoryItem.update({ where: { id: stack.id }, data: { quantity: { increment: moved } } });
      remaining -= moved;
      if (remaining === 0) return;
    }
    const occupied = new Set((await tx.inventoryItem.findMany({
      where: { characterId },
      select: { slotIndex: true },
    })).map((item: { slotIndex: number }) => item.slotIndex));
    for (let slotIndex = 0; slotIndex < INVENTORY_CAPACITY && remaining > 0; slotIndex += 1) {
      if (occupied.has(slotIndex)) continue;
      const amount = Math.min(remaining, stackLimit);
      await tx.inventoryItem.create({
        data: { characterId, itemDefinitionId, quantity: amount, slotIndex, instanceData },
      });
      occupied.add(slotIndex);
      remaining -= amount;
    }
    if (remaining > 0) throw new GameError(GAME_ERROR_CODES.INVENTORY_FULL, 'errors.items.inventoryFull');
  }

  protected itemSnapshot(definition: ItemDefinitionView): Prisma.InputJsonValue {
    return stampContentSnapshot({}, {
      instanceType: 'ITEM',
      contentVersion: CURRENT_CONTENT_VERSION,
      definitionKey: definition.key,
      definition: {
        key: definition.key,
        name: definition.name,
        description: definition.description,
        stackLimit: definition.stackLimit,
        metadata: definition.metadata,
      },
    }) as unknown as Prisma.InputJsonValue;
  }

  protected itemView(item: InventoryRecord): ItemDefinitionView {
    const snapshot = readContentSnapshot<ItemDefinitionView>(item.instanceData, 'ITEM');
    if (snapshot?.definitionKey === item.itemDefinition.key) return snapshot.definition;
    return item.itemDefinition;
  }

  protected async requireCharacter(tx: Prisma.TransactionClient, userId: string, characterId: string) {
    const character = await tx.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true, mapId: true, x: true, y: true, silver: true },
    });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    return character;
  }

  protected async requireMerchant(
    tx: Pick<Prisma.TransactionClient, 'npcDefinition'>,
    character: { mapId: string; x: number; y: number },
    npcId: string,
  ) {
    const npc = await tx.npcDefinition.findUnique({ where: { id: npcId } });
    const dialogue = npc ? parseNpcDialogueDefinition(npc.dialogue) : undefined;
    if (npc && dialogue?.merchant && isActorWithinInteractionRange(npc, character)) return { ...npc, itemKeys: dialogue.merchant.itemKeys };
    throw new GameError(GAME_ERROR_CODES.MERCHANT_NOT_AVAILABLE, 'errors.items.merchantUnavailable');
  }

  protected async requireOwnedItem(tx: Prisma.TransactionClient, userId: string, characterId: string, itemId: string) {
    const item = await tx.inventoryItem.findFirst({
      where: { id: itemId, characterId, character: { userId } },
      include: { itemDefinition: true, character: true },
    });
    if (!item) this.invalidItem();
    return item;
  }

  protected metadata(value: Prisma.JsonValue): ItemMetadata {
    const metadata = value as unknown as Partial<ItemMetadata>;
    if (
      !metadata.category ||
      !metadata.icon ||
      !metadata.rarity ||
      !['COMMON', 'ARTIFACT', 'MYTHIC'].includes(metadata.rarity) ||
      !Number.isInteger(metadata.buyPriceSilver) ||
      !Number.isInteger(metadata.sellPriceSilver)
    ) this.invalidItem();
    if (
      metadata.category === 'EQUIPMENT' &&
      (!metadata.equipmentSlot || !Number.isInteger(metadata.minimumLevel) || Number(metadata.minimumLevel) < 1)
    ) this.invalidItem();
    return metadata as ItemMetadata;
  }

  protected assertSlot(slotIndex: number): void {
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= INVENTORY_CAPACITY) this.invalidItem();
  }

  protected assertQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) this.invalidItem();
  }

  protected invalidItem(): never {
    throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
  }
}
