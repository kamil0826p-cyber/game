import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import {
  ITEM_CURSES,
  ITEM_RECIPES,
  ITEM_RELICS,
  ITEM_SALVAGE_PROFILES,
} from '../src/modules/items/itemization.catalog.js';
import {
  ITEMIZED_CATALOG,
  ItemizationCatalogService,
} from '../src/modules/items/itemization-catalog.service.js';
import {
  applyEquippedRelicsToLoadout,
  createItemInstanceSnapshot,
} from '../src/modules/items/itemization.rules.js';
import type { ItemDefinitionMetadata } from '../src/modules/items/itemization.types.js';
import { SKILL_CATALOG } from '../src/modules/skills/skill.catalog.js';
import type { SkillCombatLoadout } from '../src/modules/skills/skill.buildcraft.types.js';

const itemMetadata = (key: string): ItemDefinitionMetadata => {
  const item = ITEMIZED_CATALOG.find((candidate) => candidate.key === key);
  if (!item) throw new Error(`Missing catalog item ${key}`);
  return item.metadata;
};

const loadout = (skillKey: string): SkillCombatLoadout => {
  const definition = SKILL_CATALOG.find((candidate) => candidate.key === skillKey);
  if (!definition) throw new Error(`Missing skill ${skillKey}`);
  return {
    fallbackAction: 'DEFEND',
    buildVersion: 1,
    definitions: [{ definition, cooldownTurnsRemaining: 0 }],
  };
};

const snapshot = (definitionKey: string) =>
  createItemInstanceSnapshot({
    definitionKey,
    metadata: itemMetadata(definitionKey),
    seed: `test:${definitionKey}`,
    origin: {
      source: 'CRAFT',
      sourceKey: `recipe:${definitionKey}`,
      operationId: `craft:${definitionKey}`,
      contentVersion: 1,
      generatedAt: '2026-08-04T12:00:00.000Z',
    },
  });

describe('completed item powers', () => {
  it('turns Arcane Spark into a usable all-enemy attack instead of an empty back-row action', () => {
    const modified = applyEquippedRelicsToLoadout(
      loadout('mage-arcane-spark'),
      [snapshot('ashen-reliquary-focus')],
    );
    const definition = modified.definitions[0]?.definition;

    expect(definition?.targeting).toBe('ALL_ENEMIES');
    expect(
      definition?.effects[0]?.type === 'DAMAGE'
        ? definition.effects[0].coefficient
        : undefined,
    ).toBe(0.82);
  });

  it('makes the Execution relic and Starved Veins curse available on a real item', () => {
    const itemSnapshot = snapshot('executioners-hookblade');
    const modified = applyEquippedRelicsToLoadout(
      loadout('warrior-execution'),
      [itemSnapshot],
    );

    expect(modified.definitions[0]?.definition.energyCost).toBe(25);
    expect(itemSnapshot.relic?.key).toBe('executioners-hook-v1');
    expect(itemSnapshot.curse?.key).toBe('starved-veins-v1');
    expect(itemSnapshot.bindPolicy).toBe('ON_EQUIP');
  });

  it('keeps every declared relic, curse, recipe and salvage profile reachable', () => {
    const relicKeys = new Set(
      ITEMIZED_CATALOG.flatMap((item) =>
        item.metadata.mechanics?.relicKey ? [item.metadata.mechanics.relicKey] : [],
      ),
    );
    const curseKeys = new Set(
      ITEMIZED_CATALOG.flatMap((item) =>
        item.metadata.mechanics?.curseKey ? [item.metadata.mechanics.curseKey] : [],
      ),
    );
    const catalogKeys = new Set(ITEMIZED_CATALOG.map((item) => item.key));

    expect([...Object.keys(ITEM_RELICS)].every((key) => relicKeys.has(key))).toBe(true);
    expect([...Object.keys(ITEM_CURSES)].every((key) => curseKeys.has(key))).toBe(true);
    expect(
      Object.values(ITEM_RECIPES).every((recipe) => catalogKeys.has(recipe.outputItemKey)),
    ).toBe(true);
    expect(
      ITEMIZED_CATALOG.every((item) => {
        const key = item.metadata.mechanics?.salvageProfileKey;
        return !key || Boolean(ITEM_SALVAGE_PROFILES[key]);
      }),
    ).toBe(true);
  });

  it('migrates legacy Ashen Lens snapshots in inventory and queued claims at startup', async () => {
    const legacyInstanceData = {
      itemization: {
        relic: {
          key: 'ashen-lens-v1',
          name: 'Soczewka Popielnego Widzenia',
          description:
            'Arcane Spark może wybrać cel w tylnej linii, lecz jego współczynnik obrażeń spada do 82%.',
          skillKey: 'mage-arcane-spark',
          modifier: {
            version: 1,
            type: 'SET_TARGETING',
            targeting: 'BACK_ROW',
            coefficientMultiplier: 0.82,
          },
          powerCost: 4,
          uniqueGroup: 'skill-targeting',
          rulesVersion: 1,
        },
      },
    };
    const inventoryUpdate = vi.fn().mockResolvedValue({});
    const claimUpdate = vi.fn().mockResolvedValue({});
    const database = {
      itemDefinition: { upsert: vi.fn().mockResolvedValue({}) },
      inventoryItem: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'inventory-a', instanceData: legacyInstanceData },
        ]),
        update: inventoryUpdate,
      },
      itemClaim: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'claim-a', instanceData: legacyInstanceData },
        ]),
        update: claimUpdate,
      },
    } as unknown as PrismaService;

    await new ItemizationCatalogService(database).onModuleInit();

    expect(inventoryUpdate).toHaveBeenCalledOnce();
    expect(claimUpdate).toHaveBeenCalledOnce();
    const inventoryInput = inventoryUpdate.mock.calls[0]?.[0] as {
      data: { instanceData: { itemization: { relic: { description: string; modifier: { targeting: string } } } } };
    };
    const claimInput = claimUpdate.mock.calls[0]?.[0] as typeof inventoryInput;
    expect(inventoryInput.data.instanceData.itemization.relic.description).toBe(
      ITEM_RELICS['ashen-lens-v1']?.description,
    );
    expect(inventoryInput.data.instanceData.itemization.relic.modifier.targeting).toBe(
      'ALL_ENEMIES',
    );
    expect(claimInput.data.instanceData.itemization.relic.modifier.targeting).toBe(
      'ALL_ENEMIES',
    );
  });
});
