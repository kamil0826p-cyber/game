import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketExpirationService } from '../src/modules/items/market-expiration.service.js';
import type { MarketService } from '../src/modules/items/market.service.js';
import type { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import type { WorldStateService } from '../src/modules/world/world-state.service.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MarketExpirationService', () => {
  it('sweeps immediately, drains batches and notifies online sellers', async () => {
    vi.useFakeTimers();
    const expireListings = vi
      .fn()
      .mockResolvedValueOnce(['seller-1'])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const session = { socketId: 'socket-1', locale: 'pl' };
    const emit = vi.fn();
    const service = new MarketExpirationService(
      { expireListings } as unknown as MarketService,
      {
        getByCharacterId: vi.fn().mockImplementation((id: string) =>
          id === 'seller-1' ? session : undefined,
        ),
      } as unknown as WorldStateService,
      { emit } as unknown as WorldEventsPublisher,
    );

    service.onModuleInit();
    await vi.waitFor(() => expect(expireListings).toHaveBeenCalledTimes(2));
    expect(emit).toHaveBeenCalledWith(
      'socket-1',
      'notification',
      expect.objectContaining({ code: 'MARKET_LISTING_EXPIRED' }),
    );

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(expireListings).toHaveBeenCalledTimes(3));

    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expireListings).toHaveBeenCalledTimes(3);
  });

  it('does not overlap slow expiration sweeps', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const expireListings = vi.fn(
      () => new Promise<string[]>((resolve) => {
        release = () => resolve([]);
      }),
    );
    const service = new MarketExpirationService(
      { expireListings } as unknown as MarketService,
      { getByCharacterId: vi.fn() } as unknown as WorldStateService,
      { emit: vi.fn() } as unknown as WorldEventsPublisher,
    );

    service.onModuleInit();
    await vi.waitFor(() => expect(expireListings).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(expireListings).toHaveBeenCalledOnce();

    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(expireListings).toHaveBeenCalledTimes(2));
    service.onModuleDestroy();
  });
});
