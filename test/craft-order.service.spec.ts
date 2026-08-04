import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { CraftOrderService } from '../src/modules/items/craft-order.service.js';
import type { ItemInventoryService } from '../src/modules/items/item-inventory.service.js';
import { ITEMIZED_CATALOG } from '../src/modules/items/itemization-catalog.service.js';

const ownerId = '00000000-0000-0000-0000-000000000101';
const crafterId = '00000000-0000-0000-0000-000000000202';
const orderId = '00000000-0000-0000-0000-000000000303';
const output = ITEMIZED_CATALOG.find((item) => item.key === 'tempered-chitin-buckler')!;
const outputDefinition = {
  id: '00000000-0000-0000-0000-000000000404',
  key: output.key,
  name: output.name,
  description: output.description,
  stackLimit: output.stackLimit,
  metadata: output.metadata as unknown as Prisma.JsonValue,
};
const escrow = [
  {
    itemDefinitionId: '00000000-0000-0000-0000-000000000501',
    itemKey: 'scorpion-chitin',
    quantity: 8,
  },
  {
    itemDefinitionId: '00000000-0000-0000-0000-000000000502',
    itemKey: 'rabbit-fur',
    quantity: 3,
  },
];

const inventory = (overrides: Partial<ItemInventoryService> = {}) =>
  ({
    consumeByDefinitionKeys: vi.fn().mockResolvedValue(escrow),
    grant: vi.fn().mockResolvedValue({
      grantedQuantity: 1,
      claimedQuantity: 0,
      inventoryItemIds: ['item-1'],
      claimIds: [],
    }),
    recordEvent: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ItemInventoryService;

const prismaWithTransaction = (transaction: Prisma.TransactionClient) =>
  ({
    $transaction: vi.fn(
      async (operation: (client: Prisma.TransactionClient) => unknown) => operation(transaction),
    ),
  }) as unknown as PrismaService;

describe('CraftOrderService', () => {
  it('allows a low-level owner to escrow materials, recipe cost and a crafter reward', async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      itemCraftOrder: {
        findUnique: vi.fn().mockResolvedValue(null),
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: orderId }),
      },
      character: {
        findFirst: vi.fn().mockResolvedValue({
          id: ownerId,
          realmId: 'realm-1',
          level: 1,
          silver: 500,
          map: { key: 'greenfields' },
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      itemDefinition: { findUnique: vi.fn().mockResolvedValue(outputDefinition) },
      characterCurrencyLedger: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient;
    const itemInventory = inventory();
    const service = new CraftOrderService(prismaWithTransaction(transaction), itemInventory);

    await expect(
      service.create(
        'user-owner',
        ownerId,
        'tempered-chitin-buckler-v1',
        100,
        'create-order-1',
      ),
    ).resolves.toBe(orderId);

    expect(transaction.character.update).toHaveBeenCalledWith({
      where: { id: ownerId },
      data: { silver: 260 },
    });
    expect(transaction.itemCraftOrder.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ownerCharacterId: ownerId,
          silverEscrow: 240,
          inputEscrow: escrow,
        }),
      }),
    );
    expect(itemInventory.consumeByDefinitionKeys).toHaveBeenCalled();
  });

  it('delivers the crafted item to the owner and pays the reward to the crafter', async () => {
    const grant = vi.fn().mockResolvedValue({
      grantedQuantity: 1,
      claimedQuantity: 0,
      inventoryItemIds: ['crafted-item'],
      claimIds: [],
    });
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      itemEconomyEvent: { findUnique: vi.fn().mockResolvedValue(null) },
      itemCraftOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: orderId,
          ownerCharacterId: ownerId,
          crafterCharacterId: null,
          recipeKey: 'tempered-chitin-buckler-v1',
          recipeVersion: 1,
          status: 'OPEN',
          silverEscrow: 240,
          inputEscrow: escrow,
          outputItemDefinitionId: outputDefinition.id,
          outputQuantity: 1,
          expiresAt: new Date(Date.now() + 60_000),
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      character: {
        findFirst: vi.fn().mockResolvedValue({
          id: crafterId,
          realmId: 'realm-1',
          level: 10,
          silver: 50,
          map: { key: 'greenfields' },
        }),
        findUnique: vi.fn().mockResolvedValue({ id: ownerId, realmId: 'realm-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      itemDefinition: { findUniqueOrThrow: vi.fn().mockResolvedValue(outputDefinition) },
      characterCurrencyLedger: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient;
    const itemInventory = inventory({ grant });
    const service = new CraftOrderService(prismaWithTransaction(transaction), itemInventory);

    const result = await service.fulfill(
      'user-crafter',
      crafterId,
      orderId,
      'fulfill-order-1',
    );

    expect(grant).toHaveBeenCalledWith(
      transaction,
      expect.objectContaining({
        characterId: ownerId,
        definition: outputDefinition,
        reason: `CRAFT_ORDER:${orderId}`,
      }),
    );
    expect(transaction.character.update).toHaveBeenCalledWith({
      where: { id: crafterId },
      data: { silver: 150 },
    });
    expect(transaction.characterCurrencyLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          amount: 100,
          direction: 'CREDIT',
          reason: 'ITEM_CRAFT_REWARD',
        }),
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({
        ownerCharacterId: ownerId,
        rewardSilver: 100,
        crafterSilver: 150,
        delivery: 'INVENTORY',
      }),
    );
  });

  it('rejects fulfillment across realms before granting or paying anything', async () => {
    const grant = vi.fn();
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      itemEconomyEvent: { findUnique: vi.fn().mockResolvedValue(null) },
      itemCraftOrder: {
        findUnique: vi.fn().mockResolvedValue({
          id: orderId,
          ownerCharacterId: ownerId,
          recipeKey: 'tempered-chitin-buckler-v1',
          recipeVersion: 1,
          status: 'OPEN',
          silverEscrow: 240,
          inputEscrow: escrow,
          outputItemDefinitionId: outputDefinition.id,
          outputQuantity: 1,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      },
      character: {
        findFirst: vi.fn().mockResolvedValue({
          id: crafterId,
          realmId: 'realm-2',
          level: 10,
          silver: 50,
          map: { key: 'greenfields' },
        }),
        findUnique: vi.fn().mockResolvedValue({ id: ownerId, realmId: 'realm-1' }),
      },
    } as unknown as Prisma.TransactionClient;
    const service = new CraftOrderService(
      prismaWithTransaction(transaction),
      inventory({ grant }),
    );

    await expect(
      service.fulfill('user-crafter', crafterId, orderId, 'fulfill-order-2'),
    ).rejects.toMatchObject({
      details: expect.objectContaining({ reason: 'CRAFT_ORDER_REALM_MISMATCH' }),
    });
    expect(grant).not.toHaveBeenCalled();
  });

  it('returns the exact materials and full silver escrow when an order is cancelled', async () => {
    const materialDefinitions = escrow.map((input) => ({
      id: input.itemDefinitionId,
      key: input.itemKey,
      stackLimit: 999,
      metadata: {
        category: 'MATERIAL',
        rarity: 'COMMON',
        icon: '◆',
        buyPriceSilver: 0,
        sellPriceSilver: 1,
      } as Prisma.JsonValue,
    }));
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
          id: ownerId,
          realmId: 'realm-1',
          level: 1,
          silver: 10,
          map: { key: 'greenfields' },
        }),
        findUniqueOrThrow: vi.fn().mockResolvedValue({ silver: 10 }),
        update: vi.fn().mockResolvedValue({}),
      },
      itemCraftOrder: {
        findFirst: vi.fn().mockResolvedValue({
          id: orderId,
          ownerCharacterId: ownerId,
          recipeKey: 'tempered-chitin-buckler-v1',
          recipeVersion: 1,
          status: 'OPEN',
          silverEscrow: 240,
          inputEscrow: escrow,
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      itemDefinition: { findMany: vi.fn().mockResolvedValue(materialDefinitions) },
      characterCurrencyLedger: { create: vi.fn().mockResolvedValue({}) },
    } as unknown as Prisma.TransactionClient;
    const service = new CraftOrderService(
      prismaWithTransaction(transaction),
      inventory({ grant }),
    );

    await service.cancel('user-owner', ownerId, orderId);

    expect(grant).toHaveBeenCalledTimes(2);
    expect(transaction.character.update).toHaveBeenCalledWith({
      where: { id: ownerId },
      data: { silver: 250 },
    });
    expect(transaction.characterCurrencyLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 240 }) }),
    );
    expect(transaction.itemCraftOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });
});
