import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CraftOrderMutationResult,
  CraftingResult,
  CraftingSnapshot,
} from '../src/contracts/crafting';
import type { InventorySnapshot, SocketAck } from '../src/contracts/socket';
import type { GameSocketClient } from '../src/game/realtime/GameSocketClient';
import { installCraftingSocketBridge } from '../src/game/realtime/craftingSocketBridge';

const snapshot: CraftingSnapshot = {
  station: { npcId: 'npc-1', npcName: 'Borin', workstationKey: 'quartermaster-forge' },
  characterLevel: 10,
  mapKey: 'greenfields',
  silver: 500,
  recipes: [],
  orders: {
    rules: {
      activeOrderLimit: 10,
      activeOrderCount: 0,
      maximumRewardSilver: 10_000_000,
      ttlMs: 604_800_000,
    },
    board: [],
    mine: [],
  },
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
const orderResult = (kind: 'CREATED' | 'FULFILLED' | 'CANCELLED'): CraftOrderMutationResult => ({
  snapshot,
  mutation: {
    kind,
    orderId: '00000000-0000-0000-0000-000000000101',
    outputName: 'Hartowany puklerz chitynowy',
    rewardSilver: 100,
    ownerCharacterId: 'character-1',
  },
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('crafting player flow', () => {
  it('requests the forge and supports versioned crafting plus all craft order actions', async () => {
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      dispatchEvent: vi.fn(() => true),
    });
    const inventory: InventorySnapshot = { capacity: 40, silver: 360, items: [] };
    const getInventory = vi.fn().mockResolvedValue(inventory);
    const emit = vi.fn((event: string, payload: Record<string, unknown>, ack: (response: SocketAck<unknown>) => void) => {
      expect(payload.requestId).toEqual(expect.any(String));
      if (event === 'crafting:get') ack({ ok: true, data: snapshot });
      else if (event === 'crafting:craft') {
        expect(payload.recipeKey).toBe('tempered-chitin-buckler-v1');
        expect(payload.recipeVersion).toBe(1);
        ack({ ok: true, data: result });
      } else if (event === 'crafting:orderCreate') {
        expect(payload).toEqual(expect.objectContaining({
          recipeKey: 'tempered-chitin-buckler-v1',
          rewardSilver: 100,
        }));
        ack({ ok: true, data: orderResult('CREATED') });
      } else if (event === 'crafting:orderFulfill') {
        expect(payload.orderId).toBe('00000000-0000-0000-0000-000000000101');
        ack({ ok: true, data: orderResult('FULFILLED') });
      } else if (event === 'crafting:orderCancel') {
        expect(payload.orderId).toBe('00000000-0000-0000-0000-000000000101');
        ack({ ok: true, data: orderResult('CANCELLED') });
      } else throw new Error(`Unexpected event ${event}`);
    });
    const client = {
      socket: { connected: true, emit },
      getInventory,
    } as unknown as GameSocketClient;
    installCraftingSocketBridge(client);

    await expect(client.getCrafting()).resolves.toEqual(snapshot);
    await expect(client.craftRecipe('tempered-chitin-buckler-v1', 1)).resolves.toEqual(result);
    await expect(client.createCraftOrder('tempered-chitin-buckler-v1', 100))
      .resolves.toEqual(orderResult('CREATED'));
    await expect(client.fulfillCraftOrder('00000000-0000-0000-0000-000000000101'))
      .resolves.toEqual(orderResult('FULFILLED'));
    await expect(client.cancelCraftOrder('00000000-0000-0000-0000-000000000101'))
      .resolves.toEqual(orderResult('CANCELLED'));
    expect(getInventory).toHaveBeenCalledTimes(4);
  });

  it('retries an ambiguous craft exactly once with the same request id', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      dispatchEvent: vi.fn(() => true),
    });
    const requestIds: string[] = [];
    const getInventory = vi.fn().mockResolvedValue({ capacity: 40, silver: 360, items: [] });
    const emit = vi.fn((event: string, payload: Record<string, unknown>, ack: (response: SocketAck<unknown>) => void) => {
      if (event !== 'crafting:craft') throw new Error(`Unexpected event ${event}`);
      requestIds.push(String(payload.requestId));
      if (requestIds.length === 2) ack({ ok: true, data: result });
    });
    const client = {
      socket: { connected: true, emit },
      getInventory,
    } as unknown as GameSocketClient;
    installCraftingSocketBridge(client);

    const pending = client.craftRecipe('tempered-chitin-buckler-v1', 1);
    await vi.advanceTimersByTimeAsync(8_000);

    await expect(pending).resolves.toEqual(result);
    expect(requestIds).toHaveLength(2);
    expect(requestIds[1]).toBe(requestIds[0]);
    expect(getInventory).toHaveBeenCalledOnce();
  });

  it('invalidates the reward queue when crafted output overflows to claims', async () => {
    const dispatchEvent = vi.fn(() => true);
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      dispatchEvent,
    });
    const claimsResult: CraftingResult = {
      ...result,
      crafted: { ...result.crafted, delivery: 'CLAIMS' },
    };
    const getInventory = vi.fn().mockRejectedValue(new Error('temporary inventory refresh failure'));
    const emit = vi.fn((_event: string, _payload: unknown, ack: (response: SocketAck<CraftingResult>) => void) =>
      ack({ ok: true, data: claimsResult }),
    );
    const client = {
      socket: { connected: true, emit },
      getInventory,
    } as unknown as GameSocketClient;
    installCraftingSocketBridge(client);

    await expect(client.craftRecipe('tempered-chitin-buckler-v1', 1)).resolves.toEqual(claimsResult);
    expect(dispatchEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'game:reward-claims-invalidated' }),
    );
  });

  it('opens crafting from Borin and exposes the complete order board workflow', () => {
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
    const ordersPanel = readFileSync(
      fileURLToPath(new URL('../src/ui/modals/crafting/CraftingOrdersPanel.tsx', import.meta.url)),
      'utf8',
    );

    expect(interaction).toContain("action.type === 'OPEN_CRAFTING'");
    expect(interaction).toContain('<CraftingModal');
    expect(modal).toContain('connection.getCrafting()');
    expect(modal).toContain('connection.craftRecipe(selected.key, selected.version)');
    expect(modal).toContain('connection.createCraftOrder(recipeKey, rewardSilver)');
    expect(modal).toContain('connection.fulfillCraftOrder(orderId)');
    expect(modal).toContain('connection.cancelCraftOrder(orderId)');
    expect(modal).toContain('15_000');
    expect(details).toContain('ownedQuantity');
    expect(details).toContain('recipe.availability.canCraft');
    expect(ordersPanel).toContain('snapshot.orders.board');
    expect(ordersPanel).toContain('snapshot.orders.mine');
    expect(ordersPanel).toContain('selected.orderAvailability.canCreate');
    expect(ordersPanel).toContain('rewardSilver');
    expect(ordersPanel).toContain('totalEscrowSilver');
  });
});
