import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ITEM_RECIPES } from '../src/modules/items/itemization.catalog.js';

const read = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('crafting self-review boundaries', () => {
  it('requires the exact recipe version confirmed by the player', () => {
    const gateway = read('../src/modules/items/crafting.gateway.ts');
    const bridge = read('../frontend/src/game/realtime/craftingSocketBridge.ts');
    const modal = read('../frontend/src/ui/modals/CraftingModal.tsx');

    expect(gateway).toContain('recipeVersion = z.number().int().min(1)');
    expect(gateway).toContain('recipe.version !== payload.recipeVersion');
    expect(gateway).toContain("reason: 'RECIPE_VERSION_MISMATCH'");
    expect(bridge).toContain('recipeKey: string; recipeVersion: number');
    expect(bridge).toContain('{ requestId, recipeKey, recipeVersion }');
    expect(modal).toContain('craftRecipe(selected.key, selected.version)');
  });

  it('blocks every forge mutation during combat while leaving the snapshot readable', () => {
    const gateway = read('../src/modules/items/crafting.gateway.ts');
    const mutationChecks = gateway.match(/this\.assertMutationAllowed\(session\);/g) ?? [];

    expect(mutationChecks).toHaveLength(4);
    expect(gateway).toContain("session.combatState === 'IDLE'");
    expect(gateway).toContain('GAME_ERROR_CODES.COMBAT_ACTION_INVALID');
    expect(gateway).toContain("reason: 'CRAFTING_BLOCKED_DURING_COMBAT'");
    const getHandler = gateway.slice(
      gateway.indexOf("@SubscribeMessage('crafting:get')"),
      gateway.indexOf("@SubscribeMessage('crafting:craft')"),
    );
    expect(getHandler).not.toContain('assertMutationAllowed');
  });

  it('keeps mutation retries idempotent and does not turn a refresh failure into a craft failure', () => {
    const bridge = read('../frontend/src/game/realtime/craftingSocketBridge.ts');

    expect(bridge).toContain("const requestId = createRequestId('crafting-craft')");
    expect(bridge).toContain('if (error instanceof CraftingAckTimeoutError) return attempt()');
    expect(bridge).toContain('{ requestId, recipeKey, recipeVersion }');
    expect(bridge).toContain('await client.getInventory().catch(() => undefined)');
    expect(bridge).toContain("if (delivery === 'CLAIMS') invalidateRewardClaims()");
  });

  it('keeps the current recipe catalog compatible with the positive currency ledger constraint', () => {
    for (const recipe of Object.values(ITEM_RECIPES)) {
      expect(recipe.version).toBeGreaterThan(0);
      expect(recipe.silverCost).toBeGreaterThan(0);
      expect(recipe.inputs.length).toBeGreaterThan(0);
      expect(recipe.inputs.every((input) => input.quantity > 0)).toBe(true);
      expect(recipe.outputQuantity).toBeGreaterThan(0);
      expect(recipe.workstationKey).toBeTruthy();
    }
  });

  it('does not expose the legacy global crafting event', () => {
    const economyGateway = read('../src/modules/items/item-economy.gateway.ts');
    const craftingGateway = read('../src/modules/items/crafting.gateway.ts');

    expect(economyGateway).not.toContain("@SubscribeMessage('itemization:craft')");
    expect(craftingGateway).toContain("@SubscribeMessage('crafting:craft')");
    expect(craftingGateway).toContain('await this.requireStation(client, session)');
    expect(craftingGateway).toContain('await this.npcs.assertInteractionAvailable');
  });
});
