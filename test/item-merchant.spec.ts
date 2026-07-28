import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import { ItemService } from '../src/modules/items/item.service.js';

const npcId = '11111111-1111-4111-8111-111111111111';
const metadata = {
  category: 'CONSUMABLE',
  rarity: 'COMMON',
  icon: '●',
  effect: { energy: 30 },
  buyPriceSilver: 18,
  sellPriceSilver: 7,
};

describe('ItemService merchant selection', () => {
  it('loads only the selected NPC offer and preserves its configured order', async () => {
    const character = {
      id: 'character-1',
      mapId: 'map-a',
      x: 10,
      y: 10,
      silver: 100,
    };
    const inventoryCharacter = {
      hp: 100,
      maxHp: 100,
      energy: 50,
      maxEnergy: 50,
      strength: 10,
      agility: 10,
      intelligence: 10,
      armor: 5,
      silver: 100,
      inventoryItems: [],
    };
    const itemDefinitions = [
      {
        id: 'item-a',
        key: 'minor-health-potion',
        name: 'Health potion',
        description: 'Health',
        stackLimit: 20,
        metadata,
      },
      {
        id: 'item-b',
        key: 'field-rations',
        name: 'Rations',
        description: 'Energy',
        stackLimit: 20,
        metadata,
      },
    ];
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) =>
        operation(prisma),
      ),
      character: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce({ id: character.id })
          .mockResolvedValueOnce(character)
          .mockResolvedValueOnce(inventoryCharacter),
      },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([]) },
      itemDefinition: {
        upsert: vi.fn(),
        findMany: vi.fn().mockResolvedValue(itemDefinitions),
      },
      npcDefinition: {
        findUnique: vi.fn().mockResolvedValue({
          id: npcId,
          key: 'merchant-b',
          name: 'Merchant B',
          mapId: 'map-a',
          x: 11,
          y: 10,
          dialogue: {
            type: 'MERCHANT',
            interactionRadius: 2,
            rootNodeId: 'root',
            nodes: {
              root: {
                text: 'Welcome',
                choices: [{ id: 'shop', label: 'Shop', action: 'OPEN_MERCHANT' }],
              },
            },
            merchant: {
              itemKeys: ['field-rations', 'minor-health-potion'],
              infiniteStock: true,
            },
          },
        }),
      },
    } as unknown as PrismaService;

    const snapshot = await new ItemService(prisma).getMerchant('user-1', character.id, npcId);

    expect(prisma.npcDefinition.findUnique).toHaveBeenCalledWith({ where: { id: npcId } });
    expect(snapshot.merchant).toEqual({ id: npcId, key: 'merchant-b', name: 'Merchant B' });
    expect(snapshot.items.map((item) => item.definitionKey)).toEqual([
      'field-rations',
      'minor-health-potion',
    ]);
  });
});
