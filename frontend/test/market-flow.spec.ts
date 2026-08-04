import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MarketMutationResult, MarketSnapshot } from '../src/contracts/market';
import type { InventorySnapshot, SocketAck } from '../src/contracts/socket';
import type { GameSocketClient } from '../src/game/realtime/GameSocketClient';
import { installMarketSocketBridge } from '../src/game/realtime/marketSocketBridge';

const snapshot: MarketSnapshot = {
  station: { npcId: 'npc-1', npcName: 'Borin', marketKey: 'greenfields-market' },
  silver: 1_000,
  listings: [],
  mine: [],
  sellableItems: [],
  rules: {
    activeListingLimit: 20,
    activeListingCount: 0,
    listingTtlMs: 3 * 24 * 60 * 60 * 1000,
    listingFeeRate: 0.02,
    commissionRate: 0.05,
    minimumPriceSilver: 1,
    maximumPriceSilver: 2_147_483_647,
  },
};

const result = (kind: MarketMutationResult['mutation']['kind']): MarketMutationResult => ({
  snapshot,
  mutation: {
    kind,
    listingId: 'listing-1',
    itemName: 'Hartowany puklerz chitynowy',
    quantity: 1,
    silverDelta: kind === 'PURCHASED' ? -300 : 0,
  },
});

afterEach(() => vi.unstubAllGlobals());

describe('player market flow', () => {
  it('loads, lists, buys and cancels while refreshing inventory after mutations', async () => {
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
    const inventory: InventorySnapshot = { capacity: 40, silver: 1_000, items: [] };
    const getInventory = vi.fn().mockResolvedValue(inventory);
    const emit = vi.fn(
      (
        event: string,
        payload: Record<string, unknown>,
        ack: (response: SocketAck<unknown>) => void,
      ) => {
        expect(payload.requestId).toEqual(expect.any(String));
        if (event === 'market:get') ack({ ok: true, data: snapshot });
        else if (event === 'market:list') {
          expect(payload).toEqual(
            expect.objectContaining({ itemId: 'item-1', quantity: 2, priceSilver: 500 }),
          );
          ack({ ok: true, data: result('LISTED') });
        } else if (event === 'market:buy') {
          expect(payload.listingId).toBe('listing-1');
          ack({ ok: true, data: result('PURCHASED') });
        } else if (event === 'market:cancel') {
          expect(payload.listingId).toBe('listing-1');
          ack({ ok: true, data: result('CANCELLED') });
        } else throw new Error(`Unexpected event ${event}`);
      },
    );
    const client = {
      socket: { connected: true, emit },
      getInventory,
    } as unknown as GameSocketClient;
    installMarketSocketBridge(client);

    await expect(client.getMarket()).resolves.toEqual(snapshot);
    await expect(client.listMarketItem('item-1', 2, 500)).resolves.toEqual(result('LISTED'));
    await expect(client.buyMarketListing('listing-1')).resolves.toEqual(result('PURCHASED'));
    await expect(client.cancelMarketListing('listing-1')).resolves.toEqual(result('CANCELLED'));
    expect(getInventory).toHaveBeenCalledTimes(3);
  });

  it('opens the market from Borin and exposes browsing, selling and listing management UI', () => {
    const interaction = readFileSync(
      fileURLToPath(new URL('../src/ui/npcs/NpcInteractionLayer.tsx', import.meta.url)),
      'utf8',
    );
    const modal = readFileSync(
      fileURLToPath(new URL('../src/ui/modals/MarketModal.tsx', import.meta.url)),
      'utf8',
    );

    expect(interaction).toContain("action.type === 'OPEN_MARKET'");
    expect(interaction).toContain('<MarketModal');
    expect(modal).toContain("type MarketView = 'BROWSE' | 'MINE' | 'SELL'");
    expect(modal).toContain('connection.getMarket()');
    expect(modal).toContain('connection.listMarketItem');
    expect(modal).toContain('connection.buyMarketListing');
    expect(modal).toContain('connection.cancelMarketListing');
    expect(modal).toContain('historicalMedianUnitPriceSilver');
    expect(modal).toContain('listing.commissionSilver');
    expect(modal).toContain('item.affixes');
    expect(modal).toContain('item.relic');
    expect(modal).toContain('item.curse');
    expect(modal).toContain('window.confirm');
  });
});
