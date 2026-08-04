import { describe, expect, it } from 'vitest';
import { toInventoryItemizationPayload } from '../src/modules/items/itemization.contracts.js';
import { ITEM_SALVAGE_PROFILES } from '../src/modules/items/itemization.catalog.js';
import { ITEMIZED_CATALOG } from '../src/modules/items/itemization-catalog.service.js';
import { createItemInstanceSnapshot } from '../src/modules/items/itemization.rules.js';

const definition = ITEMIZED_CATALOG.find(
  (candidate) => candidate.key === 'executioners-hookblade',
);

if (!definition) throw new Error('Missing executioners-hookblade catalog entry');

describe('item salvage preview payload', () => {
  it('exposes the deterministic return, rare chance and pity threshold used by salvage', () => {
    const snapshot = createItemInstanceSnapshot({
      definitionKey: definition.key,
      metadata: definition.metadata,
      seed: 'salvage-preview-test',
      origin: {
        source: 'CRAFT',
        sourceKey: 'recipe:executioners-hookblade-v1',
        operationId: 'craft:salvage-preview-test',
        contentVersion: 1,
        generatedAt: '2026-08-04T15:00:00.000Z',
      },
    });
    const payload = toInventoryItemizationPayload(definition.metadata, snapshot);
    const profile = ITEM_SALVAGE_PROFILES['executioners-hookblade-v1'];

    expect(profile).toBeDefined();
    expect(payload.salvagePolicy).toBe('ALLOWED');
    expect(payload.salvage).toEqual({
      profileKey: profile?.key,
      deterministic: profile?.deterministic.map((output) => ({ ...output })),
      rare: profile?.rare
        ? {
            itemKey: profile.rare.itemKey,
            chance: profile.rare.chance,
            guaranteedAfterMisses: profile.rare.guaranteedAfterMisses,
          }
        : undefined,
    });
  });
});
