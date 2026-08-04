import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ITEM_RELICS } from './itemization.catalog.js';
import type { ItemDefinitionMetadata } from './itemization.types.js';

type CatalogDatabase = Pick<Prisma.TransactionClient, 'itemDefinition'>;

type LegacyPowerRow = {
  id: string;
  instanceData: Prisma.JsonValue;
};

export interface ItemCatalogEntry {
  key: string;
  name: string;
  description: string;
  stackLimit: number;
  metadata: ItemDefinitionMetadata;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const migrateLegacyAshenLens = (
  value: Prisma.JsonValue,
): Prisma.InputJsonValue | undefined => {
  const root = asRecord(value);
  if (!root) return undefined;
  const wrappedItemization = asRecord(root.itemization);
  const itemization = wrappedItemization ?? (root.version === 1 ? root : undefined);
  const relic = asRecord(itemization?.relic);
  const modifier = asRecord(relic?.modifier);
  if (
    !itemization ||
    !relic ||
    relic.key !== 'ashen-lens-v1' ||
    modifier?.type !== 'SET_TARGETING' ||
    modifier.targeting !== 'BACK_ROW'
  ) {
    return undefined;
  }
  const current = ITEM_RELICS['ashen-lens-v1'];
  if (!current) return undefined;
  const migratedItemization = {
    ...itemization,
    relic: {
      ...current,
      modifier: { ...current.modifier },
      rulesVersion:
        typeof relic.rulesVersion === 'number' && Number.isInteger(relic.rulesVersion)
          ? relic.rulesVersion
          : 1,
    },
  };
  const migrated = wrappedItemization
    ? { ...root, itemization: migratedItemization }
    : migratedItemization;
  return JSON.parse(JSON.stringify(migrated)) as Prisma.InputJsonValue;
};

export const ITEMIZED_CATALOG: readonly ItemCatalogEntry[] = [
  {
    key: 'traveler-sword',
    name: 'Traveler Sword',
    description: 'A dependable steel blade for a beginning warrior.',
    stackLimit: 1,
    metadata: {
      category: 'EQUIPMENT',
      rarity: 'COMMON',
      icon: '⚔',
      equipmentSlot: 'MAIN_HAND',
      requiredClass: 'WARRIOR',
      minimumLevel: 5,
      statBonuses: { strength: 3 },
      buyPriceSilver: 180,
      sellPriceSilver: 72,
      mechanics: {
        version: 1,
        archetypeKey: 'martial-main-hand',
        powerLevel: 5,
        powerBudget: 5,
        affixPoolKey: 'martial-main-hand-v1',
        affixCount: { minimum: 1, maximum: 2 },
        bindPolicy: 'NONE',
        tradePolicy: 'TRADEABLE',
        salvagePolicy: 'ALLOWED',
        salvageProfileKey: 'starter-weapon-v1',
      },
    },
  },
  {
    key: 'apprentice-staff',
    name: 'Apprentice Staff',
    description: 'A simple focus for novice spellcasters.',
    stackLimit: 1,
    metadata: {
      category: 'EQUIPMENT',
      rarity: 'ARTIFACT',
      icon: '✦',
      equipmentSlot: 'MAIN_HAND',
      requiredClass: 'MAGE',
      minimumLevel: 5,
      statBonuses: { intelligence: 3, maxEnergy: 10 },
      buyPriceSilver: 180,
      sellPriceSilver: 72,
      mechanics: {
        version: 1,
        archetypeKey: 'arcane-main-hand',
        powerLevel: 5,
        powerBudget: 9,
        affixPoolKey: 'arcane-main-hand-v1',
        affixCount: { minimum: 1, maximum: 2 },
        relicKey: 'ashen-lens-v1',
        bindPolicy: 'ON_EQUIP',
        tradePolicy: 'TRADEABLE',
        salvagePolicy: 'ALLOWED',
        salvageProfileKey: 'starter-weapon-v1',
      },
    },
  },
  {
    key: 'field-bow',
    name: 'Field Bow',
    description: 'A light bow made for quick shots.',
    stackLimit: 1,
    metadata: {
      category: 'EQUIPMENT',
      rarity: 'MYTHIC',
      icon: '➶',
      equipmentSlot: 'MAIN_HAND',
      requiredClass: 'ARCHER',
      minimumLevel: 5,
      statBonuses: { agility: 3 },
      buyPriceSilver: 180,
      sellPriceSilver: 72,
      mechanics: {
        version: 1,
        archetypeKey: 'ranger-main-hand',
        powerLevel: 5,
        powerBudget: 6,
        affixPoolKey: 'ranger-main-hand-v1',
        affixCount: { minimum: 1, maximum: 2 },
        bindPolicy: 'NONE',
        tradePolicy: 'TRADEABLE',
        salvagePolicy: 'ALLOWED',
        salvageProfileKey: 'starter-weapon-v1',
      },
    },
  },
  {
    key: 'tempered-chitin-buckler',
    name: 'Hartowany puklerz chitynowy',
    description: 'Lekka tarcza wykonana z płyt Skorpiona Kata.',
    stackLimit: 1,
    metadata: {
      category: 'EQUIPMENT',
      rarity: 'ARTIFACT',
      icon: '⬡',
      equipmentSlot: 'OFF_HAND',
      requiredClass: 'WARRIOR',
      minimumLevel: 7,
      statBonuses: { armor: 2, maxHp: 8 },
      buyPriceSilver: 0,
      sellPriceSilver: 120,
      mechanics: {
        version: 1,
        archetypeKey: 'defender-off-hand',
        powerLevel: 7,
        powerBudget: 7,
        affixPoolKey: 'defender-off-hand-v1',
        affixCount: { minimum: 1, maximum: 2 },
        bindPolicy: 'ON_EQUIP',
        tradePolicy: 'TRADEABLE',
        salvagePolicy: 'ALLOWED',
        salvageProfileKey: 'chitin-buckler-v1',
      },
    },
  },
  {
    key: 'ashen-reliquary-focus',
    name: 'Popielne ognisko relikwiarza',
    description: 'Przeklęty fokus rozszczepiający Arcane Spark pomiędzy wszystkich przeciwników.',
    stackLimit: 1,
    metadata: {
      category: 'EQUIPMENT',
      rarity: 'MYTHIC',
      icon: '◉',
      equipmentSlot: 'MAIN_HAND',
      requiredClass: 'MAGE',
      minimumLevel: 10,
      statBonuses: { intelligence: 4, maxEnergy: 8 },
      buyPriceSilver: 0,
      sellPriceSilver: 260,
      mechanics: {
        version: 1,
        archetypeKey: 'cursed-arcane-main-hand',
        powerLevel: 10,
        powerBudget: 12,
        affixPoolKey: 'arcane-main-hand-v1',
        affixCount: { minimum: 1, maximum: 2 },
        relicKey: 'ashen-lens-v1',
        curseKey: 'hollow-shell-v1',
        bindPolicy: 'ON_EQUIP',
        tradePolicy: 'TRADEABLE',
        salvagePolicy: 'ALLOWED',
        salvageProfileKey: 'ashen-focus-v1',
      },
    },
  },
  {
    key: 'executioners-hookblade',
    name: 'Hakowe ostrze Egzekutora',
    description:
      'Przeklęta broń kata. Obniża koszt Execution, osłabia otrzymywane leczenie i wiąże się z właścicielem po założeniu.',
    stackLimit: 1,
    metadata: {
      category: 'EQUIPMENT',
      rarity: 'MYTHIC',
      icon: '†',
      equipmentSlot: 'MAIN_HAND',
      requiredClass: 'WARRIOR',
      minimumLevel: 40,
      statBonuses: { strength: 6, maxHp: 12 },
      buyPriceSilver: 0,
      sellPriceSilver: 420,
      mechanics: {
        version: 1,
        archetypeKey: 'cursed-executioner-main-hand',
        powerLevel: 40,
        powerBudget: 8,
        affixPoolKey: 'martial-main-hand-v1',
        affixCount: { minimum: 1, maximum: 2 },
        relicKey: 'executioners-hook-v1',
        curseKey: 'starved-veins-v1',
        bindPolicy: 'ON_EQUIP',
        tradePolicy: 'TRADEABLE',
        salvagePolicy: 'ALLOWED',
        salvageProfileKey: 'executioners-hookblade-v1',
      },
    },
  },
];

@Injectable()
export class ItemizationCatalogService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.ensure(this.prisma);
    await this.migrateLegacyPowerSnapshots();
  }

  async ensure(database: CatalogDatabase = this.prisma): Promise<void> {
    for (const definition of ITEMIZED_CATALOG) {
      const metadata = JSON.parse(JSON.stringify(definition.metadata)) as Prisma.InputJsonValue;
      await database.itemDefinition.upsert({
        where: { key: definition.key },
        create: {
          key: definition.key,
          name: definition.name,
          description: definition.description,
          stackLimit: definition.stackLimit,
          metadata,
        },
        update: {
          name: definition.name,
          description: definition.description,
          stackLimit: definition.stackLimit,
          metadata,
        },
      });
    }
  }

  private async migrateLegacyPowerSnapshots(): Promise<void> {
    const [inventoryRows, claimRows] = await Promise.all([
      this.prisma.inventoryItem.findMany({ select: { id: true, instanceData: true } }),
      this.prisma.itemClaim.findMany({ select: { id: true, instanceData: true } }),
    ]);
    await Promise.all([
      ...inventoryRows.map((row) => this.migrateInventoryRow(row)),
      ...claimRows.map((row) => this.migrateClaimRow(row)),
    ]);
  }

  private async migrateInventoryRow(row: LegacyPowerRow): Promise<void> {
    const instanceData = migrateLegacyAshenLens(row.instanceData);
    if (!instanceData) return;
    await this.prisma.inventoryItem.update({
      where: { id: row.id },
      data: { instanceData },
    });
  }

  private async migrateClaimRow(row: LegacyPowerRow): Promise<void> {
    const instanceData = migrateLegacyAshenLens(row.instanceData);
    if (!instanceData) return;
    await this.prisma.itemClaim.update({
      where: { id: row.id },
      data: { instanceData },
    });
  }
}
