import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { ItemInventoryService } from '../src/modules/items/item-inventory.service.js';
import { createItemInstanceSnapshot } from '../src/modules/items/itemization.rules.js';
import type { ItemDefinitionMetadata } from '../src/modules/items/itemization.types.js';

const materialMetadata: ItemDefinitionMetadata = {
  category: 'MATERIAL',
  rarity: 'COMMON',
  icon: '◈',
  buyPriceSilver: 0,
  sellPriceSilver: 3,
};

const definition = {
  id: '00000000-0000-0000-0000-000000000111',
  key: 'rabbit-fur',
  stackLimit: 20,
  metadata: materialMetadata as unknown as Prisma.JsonValue,
};

const snapshot = createItemInstanceSnapshot({
  definitionKey: definition.key,
  metadata: materialMetadata,
  seed: 'claim-test',
  origin: {
    source: 'LOOT',
    sourceKey: 'rabbit-spawn',
    operationId: 'reward-1',
    contentVersion: 1,
    generatedAt: '2026-08-01T12:00:00.000Z',
  },
});

const occupiedItems = Array.from({ length: 40 }, (_, slotIndex) => ({
  id: `00000000-0000-0000-0000-${String(slotIndex + 1).padStart(12, '0')}`,
  characterId: '00000000-0000-0000-0000-000000000222',
  itemDefinitionId: `other-${slotIndex}`,
  quantity: 1,
  slotIndex,
  equippedSlot: null,
  instanceData: {},
  itemDefinition: {
    id: `other-${slotIndex}`,
    key: `other-${slotIndex}`,
    stackLimit: 1,
    metadata: {
      category: 'QUEST',
      rarity: 'COMMON',
      icon: '?',
      buyPriceSilver: 0,
      sellPriceSilver: 0,
    },
  },
}));

describe('ItemInventoryService claim queue', () => {
  it('creates a durable claim instead of dropping overflow loot', async () => {
    const itemClaimUpsert = vi.fn().mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000333',
      expiresAt: new Date('2026-08-31T12:00:00.000Z'),
    });
    const eventCreate = vi.fn().mockResolvedValue({});
    const transaction = {
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue(occupiedItems),
        update: vi.fn(),
        create: vi.fn(),
      },
      itemClaim: { upsert: itemClaimUpsert },
      itemEconomyEvent: { create: eventCreate },
    } as unknown as Prisma.TransactionClient;
    const service = new ItemInventoryService({} as PrismaService);

    const result = await service.grant(transaction, {
      characterId: '00000000-0000-0000-0000-000000000222',
      definition,
      quantity: 3,
      snapshot,
      operationId: 'encounter-reward-1',
      reason: 'ENCOUNTER:rabbit',
    });

    expect(result.grantedQuantity).toBe(0);
    expect(result.claimedQuantity).toBe(3);
    expect(itemClaimUpsert).toHaveBeenCalledOnce();
    expect((transaction.inventoryItem.create as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
    expect(eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          eventType: 'CLAIM_CREATED',
          itemDefinitionKey: 'rabbit-fur',
          quantity: 3,
        }),
      }),
    );
  });

  it('uses a free slot before creating a claim', async () => {
    const items = occupiedItems.slice(0, 39);
    const itemCreate = vi.fn().mockResolvedValue({
      id: '00000000-0000-0000-0000-000000000444',
    });
    const itemClaimUpsert = vi.fn();
    const transaction = {
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue(items),
        update: vi.fn(),
        create: itemCreate,
      },
      itemClaim: { upsert: itemClaimUpsert },
      itemEconomyEvent: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient;
    const service = new ItemInventoryService({} as PrismaService);

    const result = await service.grant(transaction, {
      characterId: '00000000-0000-0000-0000-000000000222',
      definition,
      quantity: 3,
      snapshot,
      operationId: 'encounter-reward-2',
      reason: 'ENCOUNTER:rabbit',
    });

    expect(result.grantedQuantity).toBe(3);
    expect(result.claimedQuantity).toBe(0);
    expect(itemCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ slotIndex: 39, quantity: 3 }),
      }),
    );
    expect(itemClaimUpsert).not.toHaveBeenCalled();
  });
});
