import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EquipmentSlot } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { InventorySnapshot, MerchantSnapshot } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CharacterProgressionService } from '../characters/progression/character-progression.service.js';
import { CanonicalItemService } from './canonical-item.service.js';
import type { InventoryItemizationPayload } from './itemization.contracts.js';
import { ItemInventoryService } from './item-inventory.service.js';
import { ItemizationCatalogService } from './itemization-catalog.service.js';
import {
  buildItemEquipPreview,
  createItemInstanceSnapshot,
  effectiveItemStatBonuses,
  itemSnapshotHash,
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
  writeItemInstanceData,
} from './itemization.rules.js';
import type { ItemInstanceSnapshot } from './itemization.types.js';

@Injectable()
export class ItemizedItemService extends CanonicalItemService {
  constructor(
    private readonly itemizationDatabase: PrismaService,
    private readonly characterProgression: CharacterProgressionService,
    private readonly catalog: ItemizationCatalogService,
    private readonly inventoryOperations: ItemInventoryService,
  ) {
    super(itemizationDatabase, characterProgression);
  }

  override async getInventory(userId: string, characterId: string): Promise<InventorySnapshot> {
    const snapshot = await super.getInventory(userId, characterId);
    await this.catalog.ensure();
    return this.enrichInventory(userId, characterId, snapshot);
  }

  override async getMerchant(
    userId: string,
    characterId: string,
    npcId: string,
  ): Promise<MerchantSnapshot> {
    const snapshot = await super.getMerchant(userId, characterId, npcId);
    await this.catalog.ensure();
    return {
      ...snapshot,
      inventory: await this.enrichInventory(userId, characterId, snapshot.inventory),
    };
  }

  override async buy(
    userId: string,
    characterId: string,
    npcId: string,
    itemKey: string,
    quantity: number,
    operationId: string,
  ): Promise<MerchantSnapshot> {
    const snapshot = await super.buy(
      userId,
      characterId,
      npcId,
      itemKey,
      quantity,
      operationId,
    );
    await this.catalog.ensure();
    return {
      ...snapshot,
      inventory: await this.enrichInventory(userId, characterId, snapshot.inventory),
    };
  }

  override async sell(
    userId: string,
    characterId: string,
    npcId: string,
    itemId: string,
    quantity: number,
    operationId: string,
  ): Promise<MerchantSnapshot> {
    const snapshot = await super.sell(
      userId,
      characterId,
      npcId,
      itemId,
      quantity,
      operationId,
    );
    await this.catalog.ensure();
    return {
      ...snapshot,
      inventory: await this.enrichInventory(userId, characterId, snapshot.inventory),
    };
  }

  override async move(
    userId: string,
    characterId: string,
    itemId: string,
    targetSlotIndex: number,
  ): Promise<InventorySnapshot> {
    const snapshot = await super.move(userId, characterId, itemId, targetSlotIndex);
    await this.catalog.ensure();
    return this.enrichInventory(userId, characterId, snapshot);
  }

  override async equip(
    userId: string,
    characterId: string,
    itemId: string,
    confirmationHash?: string,
  ): Promise<InventorySnapshot> {
    await this.itemizationDatabase.$transaction(async (transaction) => {
      await this.catalog.ensure(transaction);
      const item = await transaction.inventoryItem.findFirst({
        where: {
          id: itemId,
          characterId,
          character: { userId },
          tradeOfferItems: { none: {} },
        },
        include: { itemDefinition: true, character: true },
      });
      if (!item) this.rejectItemizationItem({ reason: 'ITEM_UNAVAILABLE_OR_OFFERED' });
      const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
      if (metadata.category !== 'EQUIPMENT' || !metadata.equipmentSlot) {
        this.rejectItemizationItem();
      }
      if (metadata.requiredClass && metadata.requiredClass !== item.character.class) {
        this.rejectItemizationItem();
      }
      if ((metadata.minimumLevel ?? 1) > item.character.level) {
        throw new GameError(
          GAME_ERROR_CODES.ITEM_LEVEL_REQUIRED,
          'errors.items.levelRequired',
          { required: metadata.minimumLevel ?? 1 },
        );
      }
      let snapshot = readItemInstanceSnapshot({
        instanceData: item.instanceData,
        definitionKey: item.itemDefinition.key,
        metadata,
        legacyOperationId: `legacy-migration:${item.id}`,
      });
      if (snapshot.boundCharacterId && snapshot.boundCharacterId !== characterId) {
        this.rejectItemizationItem({ reason: 'ITEM_BOUND_TO_OTHER_CHARACTER' });
      }
      const preview = buildItemEquipPreview(metadata, snapshot);
      if (preview.requiresConfirmation && confirmationHash !== preview.confirmationHash) {
        throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
          reason: 'CURSED_ITEM_CONFIRMATION_REQUIRED',
          equipPreview: preview,
        });
      }

      const newlyBound = snapshot.bindPolicy === 'ON_EQUIP' && !snapshot.boundCharacterId;
      if (newlyBound) snapshot = this.bindSnapshot(snapshot, characterId, itemId);
      await this.assertRelicLimit(
        transaction,
        characterId,
        itemId,
        metadata.equipmentSlot,
        snapshot,
      );

      await this.characterProgression.recomputeInTransaction(transaction, characterId);
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
        data: {
          equippedSlot: metadata.equipmentSlot,
          instanceData: writeItemInstanceData(item.instanceData, snapshot),
        },
      });
      if (newlyBound) {
        await this.inventoryOperations.recordEvent(transaction, {
          characterId,
          operationId: `bind:${item.id}`,
          eventType: 'ITEM_BOUND',
          itemDefinitionKey: item.itemDefinition.key,
          inventoryItemId: item.id,
          quantity: 1,
          metadata: { bindPolicy: snapshot.bindPolicy, tradePolicy: snapshot.tradePolicy },
        });
      }
      await this.characterProgression.recomputeInTransaction(transaction, characterId);
    });
    return this.getInventory(userId, characterId);
  }

  override async unequip(
    userId: string,
    characterId: string,
    itemId: string,
  ): Promise<InventorySnapshot> {
    await this.catalog.ensure();
    const snapshot = await super.unequip(userId, characterId, itemId);
    return this.enrichInventory(userId, characterId, snapshot);
  }

  override async use(
    userId: string,
    characterId: string,
    itemId: string,
  ): Promise<InventorySnapshot> {
    const snapshot = await super.use(userId, characterId, itemId);
    await this.catalog.ensure();
    return this.enrichInventory(userId, characterId, snapshot);
  }

  override async destroy(
    userId: string,
    characterId: string,
    itemId: string,
    quantity: number,
  ): Promise<InventorySnapshot> {
    const snapshot = await super.destroy(userId, characterId, itemId, quantity);
    await this.catalog.ensure();
    return this.enrichInventory(userId, characterId, snapshot);
  }

  private async enrichInventory(
    userId: string,
    characterId: string,
    snapshot: InventorySnapshot,
  ): Promise<InventorySnapshot> {
    const rows = await this.itemizationDatabase.inventoryItem.findMany({
      where: { characterId, character: { userId } },
      include: { itemDefinition: true },
    });
    const byId = new Map<
      string,
      {
        snapshot: ItemInstanceSnapshot;
        metadata: ReturnType<typeof parseItemDefinitionMetadata>;
      }
    >();
    for (const row of rows) {
      const metadata = parseItemDefinitionMetadata(row.itemDefinition.metadata);
      let itemSnapshot = readItemInstanceSnapshot({
        instanceData: row.instanceData,
        definitionKey: row.itemDefinition.key,
        metadata,
        legacyOperationId: `legacy-migration:${row.id}`,
      });
      if (!this.hasSnapshot(row.instanceData)) {
        itemSnapshot = createItemInstanceSnapshot({
          definitionKey: row.itemDefinition.key,
          metadata,
          seed: `legacy-instance:${row.id}`,
          origin: {
            source: 'LEGACY',
            sourceKey: row.itemDefinition.key,
            operationId: `legacy-migration:${row.id}`,
            contentVersion: 1,
            generatedAt: row.createdAt.toISOString(),
          },
        });
        await this.itemizationDatabase.inventoryItem.update({
          where: { id: row.id },
          data: { instanceData: writeItemInstanceData(row.instanceData, itemSnapshot) },
        });
      }
      byId.set(row.id, { snapshot: itemSnapshot, metadata });
    }
    return {
      ...snapshot,
      items: snapshot.items.map((item) => {
        const entry = byId.get(item.id);
        if (!entry) return item;
        const preview = buildItemEquipPreview(entry.metadata, entry.snapshot);
        const itemization: InventoryItemizationPayload = {
          snapshotVersion: entry.snapshot.version,
          powerLevel: entry.snapshot.powerLevel,
          powerBudget: entry.snapshot.powerBudget,
          powerSpent: entry.snapshot.powerSpent,
          affixes: entry.snapshot.affixes.map((affix) => ({
            ...affix,
            tags: [...affix.tags],
            statBonuses: { ...affix.statBonuses },
          })),
          relic: preview.relic,
          curse: preview.curse,
          craftQuality: entry.snapshot.craftQuality,
          origin: { ...entry.snapshot.origin },
          bindPolicy: entry.snapshot.bindPolicy,
          tradePolicy: entry.snapshot.tradePolicy,
          salvagePolicy: entry.snapshot.salvagePolicy,
          boundCharacterId: entry.snapshot.boundCharacterId,
          equipConfirmationHash: preview.confirmationHash,
          requiresEquipConfirmation: preview.requiresConfirmation,
        };
        return {
          ...item,
          statBonuses: effectiveItemStatBonuses(entry.metadata, entry.snapshot),
          itemization,
        };
      }),
    };
  }

  private async assertRelicLimit(
    transaction: Prisma.TransactionClient,
    characterId: string,
    itemId: string,
    replacingSlot: EquipmentSlot,
    candidate: ItemInstanceSnapshot,
  ): Promise<void> {
    const equipped = await transaction.inventoryItem.findMany({
      where: {
        characterId,
        equippedSlot: { not: null },
        id: { not: itemId },
        NOT: { equippedSlot: replacingSlot },
      },
      include: { itemDefinition: true },
    });
    const groups = new Set<string>();
    if (candidate.relic) groups.add(candidate.relic.uniqueGroup);
    for (const item of equipped) {
      const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
      const snapshot = readItemInstanceSnapshot({
        instanceData: item.instanceData,
        definitionKey: item.itemDefinition.key,
        metadata,
      });
      if (snapshot.relic) groups.add(snapshot.relic.uniqueGroup);
    }
    if (groups.size > 2) {
      this.rejectItemizationItem({ reason: 'ACTIVE_RELIC_LIMIT', limit: 2 });
    }
  }

  private bindSnapshot(
    snapshot: ItemInstanceSnapshot,
    characterId: string,
    itemId: string,
  ): ItemInstanceSnapshot {
    const next = JSON.parse(JSON.stringify(snapshot)) as ItemInstanceSnapshot;
    const beforeHash = itemSnapshotHash(snapshot);
    next.boundCharacterId = characterId;
    next.tradePolicy = 'CHARACTER_BOUND';
    const mutation = {
      sequence: next.mutations.length + 1,
      operationId: `bind:${itemId}`,
      type: 'BIND' as const,
      at: new Date().toISOString(),
      beforeHash,
      afterHash: '',
    };
    next.mutations.push(mutation);
    mutation.afterHash = createHash('sha256')
      .update(JSON.stringify({ ...next, mutations: next.mutations.slice(0, -1) }))
      .digest('hex');
    return next;
  }

  private hasSnapshot(value: Prisma.JsonValue): boolean {
    return Boolean(
      value &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        'itemization' in value,
    );
  }

  private rejectItemizationItem(details?: Record<string, unknown>): never {
    throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', details);
  }
}
