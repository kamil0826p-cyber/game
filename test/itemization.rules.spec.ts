import { describe, expect, it } from 'vitest';
import type { SkillCombatLoadout } from '../src/modules/skills/skill.buildcraft.types.js';
import {
  applyEquippedRelicsToLoadout,
  buildItemEquipPreview,
  createItemInstanceSnapshot,
  ItemTriggerRecursionGuard,
  resolveLootProtection,
  validateItemInstanceSnapshot,
} from '../src/modules/items/itemization.rules.js';
import type {
  ItemDefinitionMetadata,
  ItemInstanceSnapshot,
} from '../src/modules/items/itemization.types.js';

const origin = (operationId: string) => ({
  source: 'CRAFT' as const,
  sourceKey: 'test-recipe',
  operationId,
  contentVersion: 1,
  generatedAt: '2026-08-01T12:00:00.000Z',
});

const mageFocus: ItemDefinitionMetadata = {
  category: 'EQUIPMENT',
  rarity: 'MYTHIC',
  icon: '◉',
  equipmentSlot: 'MAIN_HAND',
  requiredClass: 'MAGE',
  minimumLevel: 10,
  statBonuses: { intelligence: 4, maxEnergy: 8 },
  buyPriceSilver: 0,
  sellPriceSilver: 260,
  mechanics: {
    version: 1,
    archetypeKey: 'cursed-arcane-main-hand',
    powerLevel: 10,
    powerBudget: 12,
    affixPoolKey: 'arcane-main-hand-v1',
    affixCount: { minimum: 2, maximum: 2 },
    relicKey: 'ashen-lens-v1',
    curseKey: 'hollow-shell-v1',
    bindPolicy: 'ON_EQUIP',
    tradePolicy: 'TRADEABLE',
    salvagePolicy: 'ALLOWED',
    salvageProfileKey: 'ashen-focus-v1',
  },
};

describe('itemization rules', () => {
  it('rolls a deterministic and power-budgeted snapshot from the same seed', () => {
    const first = createItemInstanceSnapshot({
      definitionKey: 'ashen-reliquary-focus',
      metadata: mageFocus,
      seed: 'stable-seed',
      origin: origin('craft-1'),
      craftQuality: 70,
    });
    const second = createItemInstanceSnapshot({
      definitionKey: 'ashen-reliquary-focus',
      metadata: mageFocus,
      seed: 'stable-seed',
      origin: origin('craft-1'),
      craftQuality: 70,
    });

    expect(second).toEqual(first);
    expect(first.affixes).toHaveLength(2);
    expect(new Set(first.affixes.map((affix) => affix.kind)).size).toBe(2);
    expect(first.powerSpent).toBeLessThanOrEqual(first.powerBudget);
    expect(
      first.affixes.every(
        (affix) =>
          affix.roll >= affix.minimumRoll && affix.roll <= affix.maximumRoll,
      ),
    ).toBe(true);
  });

  it('rejects a tampered snapshot that exceeds its power budget', () => {
    const snapshot = createItemInstanceSnapshot({
      definitionKey: 'ashen-reliquary-focus',
      metadata: mageFocus,
      seed: 'tamper-seed',
      origin: origin('craft-2'),
    });
    const tampered = {
      ...snapshot,
      powerBudget: 0,
    } as ItemInstanceSnapshot;

    expect(() =>
      validateItemInstanceSnapshot(tampered, 'ashen-reliquary-focus', mageFocus),
    ).toThrow('ITEM_POWER_BUDGET_EXCEEDED');
  });

  it('turns Arcane Spark into a reduced-coefficient all-enemy attack through a relic', () => {
    const snapshot = createItemInstanceSnapshot({
      definitionKey: 'ashen-reliquary-focus',
      metadata: mageFocus,
      seed: 'relic-seed',
      origin: origin('craft-3'),
    });
    const loadout: SkillCombatLoadout = {
      fallbackAction: 'DEFEND',
      buildVersion: 1,
      definitions: [
        {
          cooldownTurnsRemaining: 0,
          definition: {
            key: 'mage-arcane-spark',
            name: 'Arcane Spark',
            description: 'Test',
            characterClass: 'MAGE',
            minimumLevel: 10,
            energyCost: 10,
            cooldownTurns: 0,
            targeting: 'ENEMY',
            maxRank: 1,
            displayOrder: 1,
            treeRow: 0,
            treeColumn: 0,
            icon: '✦',
            prerequisiteKeys: [],
            effects: [
              {
                type: 'DAMAGE',
                scaling: 'INTELLIGENCE',
                coefficient: 1,
                damageType: 'ARCANE',
              },
            ],
            animationKey: 'mage-arcane-spark',
            visual: {
              castEffectKey: 'cast',
              impactEffectKey: 'impact',
              accentColor: '#fff',
            },
          },
        },
      ],
    };

    const modified = applyEquippedRelicsToLoadout(loadout, [snapshot]);
    expect(modified.definitions[0]?.definition.targeting).toBe('ALL_ENEMIES');
    expect(
      modified.definitions[0]?.definition.effects[0]?.type === 'DAMAGE'
        ? modified.definitions[0].definition.effects[0].coefficient
        : undefined,
    ).toBe(0.82);
  });

  it('returns the complete curse cost and requires an exact equip confirmation hash', () => {
    const snapshot = createItemInstanceSnapshot({
      definitionKey: 'ashen-reliquary-focus',
      metadata: mageFocus,
      seed: 'curse-seed',
      origin: origin('craft-4'),
    });
    const preview = buildItemEquipPreview(mageFocus, snapshot);

    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.confirmationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.curse).toMatchObject({
      key: 'hollow-shell-v1',
      cost: { type: 'STAT_PENALTY', statBonuses: { armor: -2 } },
    });
    expect(preview.curse?.preview).toContain('-2');
  });

  it('blocks recursive item triggers and restores the guard stack after a failure', () => {
    const guard = new ItemTriggerRecursionGuard();
    expect(() =>
      guard.run('guard-success', () =>
        guard.run('guard-success', () => 'never'),
      ),
    ).toThrow('ITEM_TRIGGER_RECURSION_BLOCKED');
    expect(guard.run('guard-success', () => 'ok')).toBe('ok');
  });

  it('guarantees pity progress and blocks valueless unique duplicates', () => {
    const pity = resolveLootProtection({
      chance: 0,
      roll: 0.99,
      misses: 4,
      guaranteedAfterMisses: 4,
    });
    expect(pity).toEqual({
      granted: true,
      guaranteed: true,
      duplicateBlocked: false,
      nextMisses: 0,
    });

    const duplicate = resolveLootProtection({
      chance: 1,
      roll: 0,
      misses: 2,
      guaranteedAfterMisses: 10,
      uniqueKey: 'relic:ashen-lens',
      ownedUniqueKeys: ['relic:ashen-lens'],
      duplicateHasValue: false,
    });
    expect(duplicate).toEqual({
      granted: false,
      guaranteed: false,
      duplicateBlocked: true,
      nextMisses: 2,
    });
  });

  it('keeps existing material item categories fungible and without forced affixes', () => {
    const material: ItemDefinitionMetadata = {
      category: 'MATERIAL',
      rarity: 'COMMON',
      icon: '◈',
      buyPriceSilver: 0,
      sellPriceSilver: 3,
    };
    const snapshot = createItemInstanceSnapshot({
      definitionKey: 'rabbit-fur',
      metadata: material,
      seed: 'material-seed',
      origin: {
        source: 'LOOT',
        sourceKey: 'rabbit-spawn',
        operationId: 'loot-1',
        contentVersion: 1,
        generatedAt: '2026-08-01T12:00:00.000Z',
      },
    });

    expect(snapshot.category).toBe('MATERIAL');
    expect(snapshot.affixes).toEqual([]);
    expect(snapshot.tradePolicy).toBe('TRADEABLE');
  });
});
