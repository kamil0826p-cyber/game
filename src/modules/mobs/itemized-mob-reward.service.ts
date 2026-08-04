import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CharacterProgressionService } from '../characters/progression/character-progression.service.js';
import { ItemInventoryService } from '../items/item-inventory.service.js';
import {
  toInventoryItemizationPayload,
  type InventoryItemizationPayload,
} from '../items/itemization.contracts.js';
import {
  effectiveItemStatBonuses,
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
} from '../items/itemization.rules.js';
import { QuestService } from '../quests/quest.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import {
  MobRewardService,
  type EncounterRewardContext,
  type MobRewardSettlement,
  type SettledLoot,
} from './mob-reward.service.js';
import type { RuntimeMob } from './mob.types.js';

type ItemizedSettledLoot = SettledLoot & {
  itemization?: InventoryItemizationPayload;
};

type RewardItemRow = {
  quantity: number;
  instanceData: Prisma.JsonValue;
  itemDefinition: {
    key: string;
    name: string;
    description: string;
    stackLimit: number;
    metadata: Prisma.JsonValue;
  };
};

@Injectable()
export class ItemizedMobRewardService extends MobRewardService {
  constructor(
    private readonly rewardDatabase: PrismaService,
    progression: CharacterProgressionService,
    inventory: ItemInventoryService,
    @Optional() quests?: QuestService,
  ) {
    super(rewardDatabase, progression, inventory, quests);
  }

  override async award(
    session: PlayerSession,
    mob: RuntimeMob,
    context?: EncounterRewardContext,
  ): Promise<MobRewardSettlement> {
    const settlement = await super.award(session, mob, context);
    const operationPrefix = context?.operationId ?? `mob:${mob.id}:${session.characterId}`;
    const [inventoryRows, claimRows] = await Promise.all([
      this.rewardDatabase.inventoryItem.findMany({
        where: { characterId: session.characterId },
        include: { itemDefinition: true },
      }),
      this.rewardDatabase.itemClaim.findMany({
        where: { characterId: session.characterId, status: 'OPEN' },
        include: { itemDefinition: true },
      }),
    ]);

    return {
      ...settlement,
      loot: this.replaceEquipmentLoot(
        settlement.loot,
        this.itemizedRows(inventoryRows, operationPrefix),
      ),
      claimQueuedLoot: this.replaceEquipmentLoot(
        settlement.claimQueuedLoot,
        this.itemizedRows(claimRows, operationPrefix),
      ),
    };
  }

  private itemizedRows(
    rows: readonly RewardItemRow[],
    operationPrefix: string,
  ): ItemizedSettledLoot[] {
    const result: ItemizedSettledLoot[] = [];
    for (const row of rows) {
      const metadata = parseItemDefinitionMetadata(row.itemDefinition.metadata);
      if (metadata.category !== 'EQUIPMENT') continue;
      const snapshot = readItemInstanceSnapshot({
        instanceData: row.instanceData,
        definitionKey: row.itemDefinition.key,
        metadata,
      });
      if (!snapshot.origin.operationId.startsWith(`${operationPrefix}:`)) continue;
      result.push({
        itemKey: row.itemDefinition.key,
        name: row.itemDefinition.name,
        description: row.itemDefinition.description,
        rarity: metadata.rarity,
        icon: metadata.icon,
        quantity: row.quantity,
        stackLimit: row.itemDefinition.stackLimit,
        equipmentSlot: metadata.equipmentSlot,
        requiredClass: metadata.requiredClass,
        minimumLevel: metadata.minimumLevel ?? 1,
        statBonuses: effectiveItemStatBonuses(metadata, snapshot),
        effect: metadata.effect,
        itemization: toInventoryItemizationPayload(metadata, snapshot),
      });
    }
    return result;
  }

  private replaceEquipmentLoot(
    base: readonly SettledLoot[],
    exact: readonly ItemizedSettledLoot[],
  ): ItemizedSettledLoot[] {
    const byKey = new Map<string, ItemizedSettledLoot[]>();
    for (const item of exact) {
      const entries = byKey.get(item.itemKey) ?? [];
      entries.push(item);
      byKey.set(item.itemKey, entries);
    }
    return base.flatMap((item) =>
      item.equipmentSlot ? (byKey.get(item.itemKey) ?? [item]) : [item],
    );
  }
}
