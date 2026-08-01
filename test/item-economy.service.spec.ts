import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { ItemEconomyService } from '../src/modules/items/item-economy.service.js';
import type { ItemInventoryService } from '../src/modules/items/item-inventory.service.js';

const ownerId = '00000000-0000-0000-0000-000000000101';
const crafterId = '00000000-0000-0000-0000-000000000202';
const orderId = '00000000-0000-0000-0000-000000000303';
const listingId = '00000000-0000-0000-0000-000000000404';
const outputDefinition = {
  id: '00000000-0000-0000-0000-000000000505',
  key: 'tempered-chitin-buckler',
  name: 'Hartowany puklerz chitynowy',
  description: 'Test',
  stackLimit: 1,
  metadata: {
    category: 'EQUIPMENT',
    rarity: 'ARTIFACT',
    icon: '⬡',
    equipmentSlot: 'OFF_HAND',
    requiredClass: 'WARRIOR',
    minimumLevel: 7,
    statBonuses: { armor: 2 },
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
  } as Prisma.JsonValue,
};

const emptySnapshotDependencies = {
  character: {
    findFirst: vi.fn().mockResolvedValue({ id: crafterId }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ silver: 500 }),
  },
  itemClaim: {
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn().mockResolvedValue([]),
  },
  itemDefinition: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  itemCraftOrder: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  itemMarketListing: {
    findMany: vi.fn().mockResolvedValue([]),
  },
};

describe('ItemEconomyService escrow', () => {
  it('removes owner materials into craft-order escrow without exposing them to a crafter', async () => {
    const consumed = [
      {
        itemDefinitionId: '00000000-0000-0000-0000-000000000601',
        itemKey: 'scorpion-chitin',
        quantity: 8,
      },
      {
        itemDefinitionId: '00000000-0000-0000-0000-000000000602',
        itemKey: 'rabbit-fur',
        quantity: 3,
      },
    ];
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      itemCraftOrder: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({
          id: orderId,
          ownerCharacterId: ownerId,
          recipeKey: 'tempered-chitin-buckler-v1',
          recipeVersion: 1,
          status: 'OPEN',
          silverEscrow: 140,
          expiresAt: new Date('2026-08-08T12:00:00.000Z'),
          createdAt: new Date('2026-08-01T12:00:00.000Z'),
        }),
      },
      character: {
        findFirst: vi.fn().mockResolvedValue({
          id: ownerId,
          level: 10,
          silver: 500,
          map: { key: 'greenfields' },
        }),
        update: vi.fn().mockResolvedValue({ silver: 360 }),
      },
      itemDefinition: {
        findUnique: vi.fn().mockResolvedValue(outputDefinition),
      },
      characterCurrencyLedger: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient;
    const prisma = {
      ...emptySnapshotDependencies,
      $transaction: vi.fn(async (operation: (tx: Prisma.TransactionClient) => unknown) =>
        operation(transaction),
      ),
      character: {
        findFirst: vi.fn().mockResolvedValue({ id: ownerId }),
      },
      itemCraftOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: orderId,
          ownerCharacterId: ownerId,
          recipeKey: 'tempered-chitin-buckler-v1',
          recipeVersion: 1,
          status: 'OPEN',
          silverEscrow: 140,
          expiresAt: new Date('2026-08-08T12:00:00.000Z'),
          createdAt: new Date('2026-08-01T12:00:00.000Z'),
        }),
      },
    } as unknown as PrismaService;
    const inventory = {
      consumeByDefinitionKeys: vi.fn().mockResolvedValue(consumed),
      recordEvent: vi.fn().mockResolvedValue(undefined),
    } as unknown as ItemInventoryService;
    const service = new ItemEconomyService(prisma, inventory);

    await service.createCraftOrder(
      'user-owner',
      ownerId,
      'tempered-chitin-buckler-v1',
      'create-order-1',
    );

    expect(inventory.consumeByDefinitionKeys).toHaveBeenCalledWith(
      transaction,
      ownerId,
      expect.arrayContaining([
        { itemKey: 'scorpion-chitin', quantity: 8 },
        { itemKey: 'rabbit-fur', quantity: 3 },
      ]),
    );
    expect(transaction.itemCraftOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerCharacterId: ownerId,
          crafterCharacterId: undefined,
          inputEscrow: consumed,
          silverEscrow: 140,
        }),
      }),
    );
  });

  it('delivers a fulfilled order directly to the owner, never to the crafter', async () => {
    const grant = vi.fn().mockResolvedValue({
      grantedQuantity: 1,
      claimedQuantity: 0,
      inventoryItemIds: ['item-1'],
      claimIds: [],
    });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      character: {
        findFirst: vi.fn().mockResolvedValue({
          id: crafterId,
          level: 10,
          silver: 500,
          map: { key: 'greenfields' },
        }),
      },
      itemCraftOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: orderId,
          ownerCharacterId: ownerId,
          crafterCharacterId: null,
          recipeKey: 'tempered-chitin-buckler-v1',
          recipeVersion: 1,
          status: 'OPEN',
          silverEscrow: 140,
          inputEscrow: [],
          outputItemDefinitionId: outputDefinition.id,
          outputQuantity: 1,
          operationId: 'create-order-1',
          expiresAt: new Date(Date.now() + 60_000),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      itemDefinition: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(outputDefinition),
      },
    } as unknown as Prisma.TransactionClient;
    const prisma = {
      ...emptySnapshotDependencies,
      $transaction: vi.fn(async (operation: (tx: Prisma.TransactionClient) => unknown) =>
        operation(transaction),
      ),
      character: {
        findFirst: vi.fn().mockResolvedValue({ id: crafterId }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ silver: 500 }),
      },
    } as unknown as PrismaService;
    const inventory = {
      grant,
      recordEvent: vi.fn().mockResolvedValue(undefined),
      listOpenClaims: vi.fn().mockResolvedValue([]),
    } as unknown as ItemInventoryService;
    const service = new ItemEconomyService(prisma, inventory);

    await service.fulfillCraftOrder('user-crafter', crafterId, orderId, 'fulfill-order-1');

    expect(grant).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        characterId: ownerId,
        quantity: 1,
        reason: `CRAFT_ORDER:${orderId}`,
      }),
    );
    expect(grant).not.toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({ characterId: crafterId }),
    );
    expect(transaction.itemCraftOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'COMPLETED',
          crafterCharacterId: crafterId,
          silverEscrow: 0,
          inputEscrow: [],
        }),
      }),
    );
  });

  it('returns exactly the escrowed listing item on cancellation', async () => {
    const listingInstanceData = {
      itemization: {
        version: 1,
        marker: 'preserve-this-exact-snapshot',
      },
    } as unknown as Prisma.JsonValue;
    const grant = vi.fn().mockResolvedValue({
      grantedQuantity: 1,
      claimedQuantity: 0,
      inventoryItemIds: ['returned-item'],
      claimIds: [],
    });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      character: {
        findFirst: vi.fn().mockResolvedValue({ id: ownerId }),
      },
      itemMarketListing: {
        findFirst: vi.fn().mockResolvedValue({
          id: listingId,
          sellerCharacterId: ownerId,
          itemDefinitionId: outputDefinition.id,
          quantity: 1,
          instanceData: listingInstanceData,
          listingFeeSilver: 10,
          status: 'ACTIVE',
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      itemDefinition: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(outputDefinition),
      },
    } as unknown as Prisma.TransactionClient;
    const prisma = {
      ...emptySnapshotDependencies,
      $transaction: vi.fn(async (operation: (tx: Prisma.TransactionClient) => unknown) =>
        operation(transaction),
      ),
      character: {
        findFirst: vi.fn().mockResolvedValue({ id: ownerId }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ silver: 500 }),
      },
    } as unknown as PrismaService;
    const inventory = {
      grant,
      recordEvent: vi.fn().mockResolvedValue(undefined),
      listOpenClaims: vi.fn().mockResolvedValue([]),
    } as unknown as ItemInventoryService;
    const service = new ItemEconomyService(prisma, inventory);

    await expect(
      service.cancelMarketListing('user-owner', ownerId, listingId, 'cancel-listing-1'),
    ).rejects.toThrow('ITEM_SNAPSHOT_INVALID');

    expect(grant).not.toHaveBeenCalled();
  });
});
