import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { ItemEconomyService } from '../src/modules/items/item-economy.service.js';
import type { ItemInventoryService } from '../src/modules/items/item-inventory.service.js';
import {
  createItemInstanceSnapshot,
  writeItemInstanceData,
} from '../src/modules/items/itemization.rules.js';
import type { ItemDefinitionMetadata } from '../src/modules/items/itemization.types.js';

const ownerId = '00000000-0000-0000-0000-000000000101';
const crafterId = '00000000-0000-0000-0000-000000000202';
const buyerId = '00000000-0000-0000-0000-000000000203';
const orderId = '00000000-0000-0000-0000-000000000303';
const listingId = '00000000-0000-0000-0000-000000000404';

const outputMetadata: ItemDefinitionMetadata = {
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
};

const outputDefinition = {
  id: '00000000-0000-0000-0000-000000000505',
  key: 'tempered-chitin-buckler',
  name: 'Hartowany puklerz chitynowy',
  description: 'Test',
  stackLimit: 1,
  metadata: outputMetadata as unknown as Prisma.JsonValue,
};

const escrowedSnapshot = createItemInstanceSnapshot({
  definitionKey: outputDefinition.key,
  metadata: outputMetadata,
  seed: 'market-escrow-seed',
  origin: {
    source: 'CRAFT',
    sourceKey: 'tempered-chitin-buckler-v1',
    operationId: 'craft-origin-1',
    contentVersion: 1,
    generatedAt: '2026-08-01T12:00:00.000Z',
    recipeKey: 'tempered-chitin-buckler-v1',
    recipeVersion: 1,
    crafterCharacterId: ownerId,
  },
});
const escrowedInstanceData = writeItemInstanceData(undefined, escrowedSnapshot);

const snapshotPrisma = (
  characterId: string,
  transaction: Prisma.TransactionClient,
): PrismaService =>
  ({
    $transaction: vi.fn(
      async (operation: (tx: Prisma.TransactionClient) => unknown) => operation(transaction),
    ),
    character: {
      findFirst: vi.fn().mockResolvedValue({ id: characterId }),
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
  }) as unknown as PrismaService;

const inventoryMock = (overrides: Partial<ItemInventoryService> = {}): ItemInventoryService =>
  ({
    consumeByDefinitionKeys: vi.fn(),
    grant: vi.fn(),
    recordEvent: vi.fn().mockResolvedValue(undefined),
    listOpenClaims: vi.fn().mockResolvedValue([]),
    ...overrides,
  }) as unknown as ItemInventoryService;

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
      $transaction: vi.fn(
        async (operation: (tx: Prisma.TransactionClient) => unknown) => operation(transaction),
      ),
      character: { findFirst: vi.fn().mockResolvedValue({ id: ownerId }) },
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
    const inventory = inventoryMock({
      consumeByDefinitionKeys: vi.fn().mockResolvedValue(consumed),
    });
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
          inputEscrow: consumed,
          silverEscrow: 140,
        }),
      }),
    );
    const createData = (transaction.itemCraftOrder.create as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]?.data;
    expect(createData).not.toHaveProperty('crafterCharacterId');
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
      itemEconomyEvent: { findUnique: vi.fn().mockResolvedValue(null) },
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
    const prisma = snapshotPrisma(crafterId, transaction);
    const inventory = inventoryMock({ grant });
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

  it('returns the exact escrowed item snapshot when a listing is cancelled', async () => {
    const grant = vi.fn().mockResolvedValue({
      grantedQuantity: 1,
      claimedQuantity: 0,
      inventoryItemIds: ['returned-item'],
      claimIds: [],
    });
    const listing = {
      id: listingId,
      sellerCharacterId: ownerId,
      itemDefinitionId: outputDefinition.id,
      quantity: 1,
      instanceData: escrowedInstanceData as Prisma.JsonValue,
      listingFeeSilver: 10,
      status: 'ACTIVE',
    };
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      character: {
        findFirst: vi.fn().mockResolvedValue({
          id: ownerId,
          level: 10,
          silver: 500,
          map: { key: 'greenfields' },
        }),
      },
      itemMarketListing: {
        findFirst: vi.fn().mockResolvedValue(listing),
        update: vi.fn().mockResolvedValue({}),
      },
      itemDefinition: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(outputDefinition),
      },
    } as unknown as Prisma.TransactionClient;
    const prisma = snapshotPrisma(ownerId, transaction);
    const inventory = inventoryMock({ grant });
    const service = new ItemEconomyService(prisma, inventory);

    await service.cancelMarketListing('user-owner', ownerId, listingId, 'cancel-listing-1');

    expect(grant).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        characterId: ownerId,
        definition: outputDefinition,
        quantity: 1,
        snapshot: escrowedSnapshot,
        reason: 'MARKET_CANCELLED',
      }),
    );
    expect(transaction.itemMarketListing.update).toHaveBeenCalledWith({
      where: { id: listingId },
      data: { status: 'CANCELLED', closedAt: expect.any(Date) },
    });
  });

  it('commits an expired listing return before reporting the purchase failure', async () => {
    const grant = vi.fn().mockResolvedValue({
      grantedQuantity: 1,
      claimedQuantity: 0,
      inventoryItemIds: ['returned-item'],
      claimIds: [],
    });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      character: {
        findFirst: vi.fn().mockResolvedValue({
          id: buyerId,
          level: 10,
          silver: 500,
          map: { key: 'greenfields' },
        }),
      },
      characterCurrencyLedger: { findUnique: vi.fn().mockResolvedValue(null) },
      itemMarketListing: {
        findUnique: vi.fn().mockResolvedValue({
          id: listingId,
          sellerCharacterId: ownerId,
          itemDefinitionId: outputDefinition.id,
          quantity: 1,
          instanceData: escrowedInstanceData as Prisma.JsonValue,
          listingFeeSilver: 10,
          priceSilver: 200,
          status: 'ACTIVE',
          expiresAt: new Date(Date.now() - 1_000),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      itemDefinition: {
        findUniqueOrThrow: vi.fn().mockResolvedValue(outputDefinition),
      },
    } as unknown as Prisma.TransactionClient;
    const prisma = snapshotPrisma(buyerId, transaction);
    const inventory = inventoryMock({ grant });
    const service = new ItemEconomyService(prisma, inventory);

    await expect(
      service.buyMarketListing('user-buyer', buyerId, listingId, 'buy-expired-1'),
    ).rejects.toMatchObject({
      details: expect.objectContaining({
        reason: 'MARKET_LISTING_EXPIRED_RETURNED',
      }),
    });

    expect(grant).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        characterId: ownerId,
        snapshot: escrowedSnapshot,
        reason: 'MARKET_EXPIRED',
      }),
    );
    expect(transaction.itemMarketListing.update).toHaveBeenCalledWith({
      where: { id: listingId },
      data: { status: 'EXPIRED', closedAt: expect.any(Date) },
    });
  });
});
