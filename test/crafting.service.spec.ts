import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import type { Prisma } from '../src/generated/prisma/client.js';
import { CraftingService } from '../src/modules/items/crafting.service.js';
import type { ItemEconomyService } from '../src/modules/items/item-economy.service.js';
import { ITEM_RECIPES } from '../src/modules/items/itemization.catalog.js';
import { ITEMIZED_CATALOG } from '../src/modules/items/itemization-catalog.service.js';
import type { NpcService } from '../src/modules/npcs/npc.service.js';

const outputKeys = new Set(Object.values(ITEM_RECIPES).map((recipe) => recipe.outputItemKey));
const outputDefinitions = ITEMIZED_CATALOG.filter((item) => outputKeys.has(item.key)).map((item) => ({
  key: item.key,
  name: item.name,
  description: item.description,
  metadata: item.metadata as unknown as Prisma.JsonValue,
}));
const materialDefinitions = [
  ['scorpion-chitin', 'Chityna skorpiona', '⬡'],
  ['rabbit-fur', 'Królicze futro', '◌'],
  ['venom-sac', 'Woreczek jadowy', '◆'],
  ['scorpion-stinger', 'Żądło skorpiona', '⌁'],
  ['rabbit-foot', 'Królicza łapka', '♧'],
].map(([key, name, icon]) => ({
  key,
  name,
  description: name,
  metadata: {
    category: 'MATERIAL',
    rarity: 'COMMON',
    icon,
    buyPriceSilver: 0,
    sellPriceSilver: 1,
  } as Prisma.JsonValue,
}));

const economy = (craft = vi.fn().mockResolvedValue(undefined)) =>
  ({ craft }) as unknown as ItemEconomyService;
const npcs = (clearMapCache = vi.fn()) =>
  ({ clearMapCache }) as unknown as NpcService;

describe('CraftingService', () => {
  it('adds a forge choice to Borin without removing his merchant dialogue', async () => {
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      npcDefinition: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'npc-1',
            dialogue: {
              type: 'MERCHANT',
              rootNodeId: 'welcome',
              nodes: {
                welcome: {
                  text: { en: 'Welcome', pl: 'Witaj' },
                  choices: [
                    { id: 'show-offer', label: { en: 'Shop', pl: 'Sklep' }, action: 'OPEN_MERCHANT' },
                    { id: 'decline', label: { en: 'Leave', pl: 'Wyjdź' }, action: 'CLOSE' },
                  ],
                },
              },
              merchant: { itemKeys: ['traveler-sword'], infiniteStock: true },
            },
          },
        ]),
        update,
      },
    } as unknown as PrismaService;
    const clearMapCache = vi.fn();
    const service = new CraftingService(prisma, economy(), npcs(clearMapCache));

    await service.onModuleInit();

    const dialogue = (update.mock.calls[0]?.[0]?.data.dialogue ?? {}) as Record<string, any>;
    expect(dialogue.merchant.itemKeys).toEqual(['traveler-sword']);
    expect(dialogue.crafting).toEqual({ workstationKey: 'quartermaster-forge' });
    expect(dialogue.nodes.welcome.choices).toContainEqual(
      expect.objectContaining({ id: 'open-crafting', action: 'OPEN_CRAFTING' }),
    );
    expect(clearMapCache).toHaveBeenCalledOnce();
  });

  it('returns craftable recipes with authoritative inventory counts and item powers', async () => {
    const quantities = new Map([
      ['scorpion-chitin', 20],
      ['rabbit-fur', 10],
      ['venom-sac', 10],
      ['scorpion-stinger', 10],
      ['rabbit-foot', 10],
    ]);
    const prisma = {
      character: {
        findFirst: vi.fn().mockResolvedValue({
          level: 40,
          silver: 2_000,
          map: { key: 'greenfields' },
        }),
      },
      itemDefinition: {
        findMany: vi.fn().mockResolvedValue([...outputDefinitions, ...materialDefinitions]),
      },
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue(
          [...quantities].map(([key, quantity]) => ({ quantity, itemDefinition: { key } })),
        ),
      },
    } as unknown as PrismaService;
    const service = new CraftingService(prisma, economy(), npcs());

    const snapshot = await service.getSnapshot(
      'user-1',
      'character-1',
      { npcId: 'npc-1', workstationKey: 'quartermaster-forge' },
      'Borin Żelazna Dłoń',
    );

    expect(snapshot.recipes).toHaveLength(3);
    expect(snapshot.recipes.every((recipe) => recipe.availability.canCraft)).toBe(true);
    expect(snapshot.recipes.find((recipe) => recipe.key === 'tempered-chitin-buckler-v1')?.inputs)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ itemKey: 'scorpion-chitin', ownedQuantity: 20, requiredQuantity: 8 }),
      ]));
    expect(snapshot.recipes.find((recipe) => recipe.key === 'ashen-reliquary-focus-v1')?.output)
      .toEqual(expect.objectContaining({
        relic: expect.objectContaining({ key: 'ashen-lens-v1' }),
        curse: expect.objectContaining({ key: 'hollow-shell-v1' }),
      }));
  });
});
