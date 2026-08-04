import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CraftingResult, CraftingSnapshot } from '../src/contracts/crafting';
import type { InventorySnapshot, SocketAck } from '../src/contracts/socket';
import type { GameSocketClient } from '../src/game/realtime/GameSocketClient';
import { installCraftingSocketBridge } from '../src/game/realtime/craftingSocketBridge';

const snapshot: CraftingSnapshot = {
  station: { npcId: 'npc-1', npcName: 'Borin', workstationKey: 'quartermaster-forge' },
  characterLevel: 10,
  mapKey: 'greenfields',
  silver: 500,
  recipes: [],
};
const result: CraftingResult = {
  snapshot,
  crafted: {
    recipeKey: 'tempered-chitin-buckler-v1',
    definitionKey: 'tempered-chitin-buckler',
    name: 'Hartowany puklerz chitynowy',
    quantity: 1,
    delivery: 'INVENTORY',
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('crafting player flow', () => {
  it('requests the forge, crafts a recipe and refreshes inventory', async () => {
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const inventory: InventorySnapshot = { capacity: 40, silver: 360, items: [] };
    const getInventory = vi.fn().mockResolvedValue(inventory);
    const emit = vi.fn((event: string, payload: Record<string, unknown>, ack: (response: SocketAck<unknown>) => void) => {
      expect(payload.requestId).toEqual(expect.any(String));
      if (event === 'crafting:get') ack({ ok: true, data: snapshot });
      else if (event === 'crafting:craft') {
        expect(payload.recipeKey).toBe('tempered-chitin-buckler-v1');
        ack({ ok: true, data: result });
      } else throw new Error(`Unexpected event ${event}`);
    });
    const client = {
      socket: { connected: true, emit },
      getInventory,
    } as unknown as GameSocketClient;
    installCraftingSocketBridge(client);

    await expect(client.getCrafting()).resolves.toEqual(snapshot);
    await expect(client.craftRecipe('tempered-chitin-buckler-v1')).resolves.toEqual(result);
    expect(getInventory).toHaveBeenCalledOnce();
  });

  it('opens crafting from Borin and exposes all recipe requirements in the UI', () => {
    const interaction = readFileSync(
      fileURLToPath(new URL('../src/ui/npcs/NpcInteractionLayer.tsx', import.meta.url)),
      'utf8',
    );
    const modal = readFileSync(
      fileURLToPath(new URL('../src/ui/modals/CraftingModal.tsx', import.meta.url)),
      'utf8',
    );
    const details = readFileSync(
      fileURLToPath(new URL('../src/ui/modals/crafting/CraftingRecipeDetails.tsx', import.meta.url)),
      'utf8',
    );

    expect(interaction).toContain("action.type === 'OPEN_CRAFTING'");
    expect(interaction).toContain('<CraftingModal');
    expect(modal).toContain('connection.getCrafting()');
    expect(modal).toContain('connection.craftRecipe(selected.key)');
    expect(modal).toContain('confirmCraft');
    expect(details).toContain('ownedQuantity');
    expect(details).toContain('recipe.availability.canCraft');
    expect(details).toContain('recipe.output.relic');
    expect(details).toContain('recipe.output.curse');
  });
});
