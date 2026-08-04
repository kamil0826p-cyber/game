import { afterEach, describe, expect, it, vi } from 'vitest';
import { CraftOrderExpirationService } from '../src/modules/items/craft-order-expiration.service.js';
import type { CraftOrderService } from '../src/modules/items/craft-order.service.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CraftOrderExpirationService', () => {
  it('sweeps immediately, drains full batches and schedules later sweeps', async () => {
    vi.useFakeTimers();
    const expireOrders = vi
      .fn()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);
    const service = new CraftOrderExpirationService({ expireOrders } as unknown as CraftOrderService);

    service.onModuleInit();
    await vi.waitFor(() => expect(expireOrders).toHaveBeenCalledTimes(2));

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(expireOrders).toHaveBeenCalledTimes(3));

    service.onModuleDestroy();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(expireOrders).toHaveBeenCalledTimes(3);
  });

  it('prevents overlapping sweeps', async () => {
    vi.useFakeTimers();
    let release: (() => void) | undefined;
    const expireOrders = vi.fn(
      () => new Promise<number>((resolve) => {
        release = () => resolve(0);
      }),
    );
    const service = new CraftOrderExpirationService({ expireOrders } as unknown as CraftOrderService);

    service.onModuleInit();
    await vi.waitFor(() => expect(expireOrders).toHaveBeenCalledOnce());
    await vi.advanceTimersByTimeAsync(120_000);
    expect(expireOrders).toHaveBeenCalledOnce();

    release?.();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => expect(expireOrders).toHaveBeenCalledTimes(2));

    service.onModuleDestroy();
  });
});
