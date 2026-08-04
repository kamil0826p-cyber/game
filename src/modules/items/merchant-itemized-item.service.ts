import { Injectable } from '@nestjs/common';
import type { MerchantSnapshot } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import { CharacterProgressionService } from '../characters/progression/character-progression.service.js';
import { ItemInventoryService } from './item-inventory.service.js';
import { ItemizedItemService } from './itemized-item.service.js';
import { ItemizationCatalogService } from './itemization-catalog.service.js';
import { toInventoryItemizationPayload } from './itemization.contracts.js';
import {
  createItemInstanceSnapshot,
  effectiveItemStatBonuses,
  parseItemDefinitionMetadata,
  writeItemInstanceData,
} from './itemization.rules.js';

@Injectable()
export class MerchantItemizedItemService extends ItemizedItemService {
  constructor(
    private readonly merchantDatabase: PrismaService,
    progression: CharacterProgressionService,
    catalog: ItemizationCatalogService,
    inventory: ItemInventoryService,
  ) {
    super(merchantDatabase, progression, catalog, inventory);
  }

  override async getMerchant(
    userId: string,
    characterId: string,
    npcId: string,
  ): Promise<MerchantSnapshot> {
    return this.enrichMerchantItems(await super.getMerchant(userId, characterId, npcId), npcId);
  }

  override async buy(
    userId: string,
    characterId: string,
    npcId: string,
    itemKey: string,
    quantity: number,
    operationId: string,
  ): Promise<MerchantSnapshot> {
    const previousRows = await this.merchantDatabase.inventoryItem.findMany({
      where: { characterId, itemDefinition: { key: itemKey } },
      select: { id: true },
    });
    await super.buy(userId, characterId, npcId, itemKey, quantity, operationId);
    await this.replaceNewMerchantEquipmentSnapshots(
      characterId,
      npcId,
      itemKey,
      operationId,
      previousRows.map((row) => row.id),
    );
    return this.getMerchant(userId, characterId, npcId);
  }

  override async sell(
    userId: string,
    characterId: string,
    npcId: string,
    itemId: string,
    quantity: number,
    operationId: string,
  ): Promise<MerchantSnapshot> {
    await super.sell(userId, characterId, npcId, itemId, quantity, operationId);
    return this.getMerchant(userId, characterId, npcId);
  }

  private async enrichMerchantItems(
    snapshot: MerchantSnapshot,
    npcId: string,
  ): Promise<MerchantSnapshot> {
    const definitions = await this.merchantDatabase.itemDefinition.findMany({
      where: { key: { in: snapshot.items.map((item) => item.definitionKey) } },
    });
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    return {
      ...snapshot,
      items: snapshot.items.map((item) => {
        const definition = byKey.get(item.definitionKey);
        if (!definition) return item;
        const metadata = parseItemDefinitionMetadata(definition.metadata);
        if (metadata.category !== 'EQUIPMENT') return item;
        const preview = createItemInstanceSnapshot({
          definitionKey: definition.key,
          metadata,
          seed: this.merchantSeed(npcId, definition.key),
          origin: {
            source: 'MERCHANT',
            sourceKey: npcId,
            operationId: `merchant-preview:${npcId}:${definition.key}`,
            contentVersion: 1,
            generatedAt: new Date(0).toISOString(),
          },
        });
        return {
          ...item,
          statBonuses: effectiveItemStatBonuses(metadata, preview),
          itemization: toInventoryItemizationPayload(metadata, preview),
        };
      }),
    };
  }

  private async replaceNewMerchantEquipmentSnapshots(
    characterId: string,
    npcId: string,
    itemKey: string,
    operationId: string,
    previousIds: string[],
  ): Promise<void> {
    const rows = await this.merchantDatabase.inventoryItem.findMany({
      where: {
        characterId,
        itemDefinition: { key: itemKey },
        ...(previousIds.length > 0 ? { id: { notIn: previousIds } } : {}),
      },
      include: { itemDefinition: true },
      orderBy: { createdAt: 'asc' },
    });
    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index]!;
      const metadata = parseItemDefinitionMetadata(row.itemDefinition.metadata);
      if (metadata.category !== 'EQUIPMENT') continue;
      const itemSnapshot = createItemInstanceSnapshot({
        definitionKey: row.itemDefinition.key,
        metadata,
        seed: this.merchantSeed(npcId, row.itemDefinition.key),
        origin: {
          source: 'MERCHANT',
          sourceKey: npcId,
          operationId: `merchant-buy:${operationId}:${index}`,
          contentVersion: 1,
          generatedAt: row.createdAt.toISOString(),
        },
      });
      await this.merchantDatabase.inventoryItem.update({
        where: { id: row.id },
        data: { instanceData: writeItemInstanceData(row.instanceData, itemSnapshot) },
      });
    }
  }

  private merchantSeed(npcId: string, itemKey: string): string {
    return `merchant:${npcId}:${itemKey}`;
  }
}
