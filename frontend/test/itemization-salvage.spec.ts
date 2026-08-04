import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InventorySnapshot, SocketAck } from '../src/contracts/socket';
import type { GameSocketClient } from '../src/game/realtime/GameSocketClient';
import { installItemizationSocketBridge } from '../src/game/realtime/itemizationSocketBridge';

const economySnapshot = {
  silver: 100,
  recipes: [],
  claims: [],
  craftOrders: [],
  listings: [],
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('item salvage player flow', () => {
  it('sends the salvage command and refreshes the inventory after success', async () => {
    vi.stubGlobal('window', {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });

    const refreshedInventory: InventorySnapshot = {
      capacity: 40,
      silver: 100,
      items: [],
    };
    const getInventory = vi.fn().mockResolvedValue(refreshedInventory);
    const emit = vi.fn(
      (
        event: string,
        payload: { requestId: string; itemId: string },
        acknowledgement: (response: SocketAck<typeof economySnapshot>) => void,
      ) => {
        expect(event).toBe('itemization:salvage');
        expect(payload.itemId).toBe('item-to-salvage');
        expect(payload.requestId).toMatch(/^item-salvage-/);
        acknowledgement({ ok: true, data: economySnapshot });
      },
    );
    const client = {
      socket: { connected: true, emit },
      getInventory,
    } as unknown as GameSocketClient;

    installItemizationSocketBridge(client);

    await expect(client.salvageInventoryItem('item-to-salvage')).resolves.toEqual(
      refreshedInventory,
    );
    expect(getInventory).toHaveBeenCalledOnce();
  });

  it('exposes exact salvage rewards and confirmed destructive actions in the inventory modal', () => {
    const modalPath = fileURLToPath(
      new URL('../src/ui/modals/InventoryModal.tsx', import.meta.url),
    );
    const source = readFileSync(modalPath, 'utf8');

    expect(source).toContain("itemization?.salvagePolicy === 'ALLOWED'");
    expect(source).toContain('item.itemization?.salvage');
    expect(source).toContain('Gwarantowany odzysk');
    expect(source).toContain('Możliwy rzadki odzysk');
    expect(source).toContain('guaranteedAfterMisses');
    expect(source).toContain('Rozłóż na materiały');
    expect(source).toContain('confirmSalvage');
    expect(source).toContain('connection.salvageInventoryItem(item.id)');
    expect(source).toContain('confirmDestroy');
    expect(source).toContain('Nie otrzymasz żadnych materiałów');
  });
});
