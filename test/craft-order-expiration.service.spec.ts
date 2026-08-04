import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import { CraftOrderExpirationService } from '../src/modules/items/craft-order-expiration.service.js';
import type { CraftOrderService } from '../src/modules/items/craft-order.service.js';
import type { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import type { WorldStateService } from '../src/modules/world/world-state.service.js';

const dependencies = (
  expireOrders: ReturnType<typeof vi.fn>,
  sessions: Array<{
    socketId: string;
    characterId: string;
    silver: number;
    stateRevision: number;
    dirty: boolean;
  }> = [],
  balances: Array<{ id: string; silver: number }> = [],
) => {
  const emit = vi.fn();
  return {
    craftOrders: { expireOrders } as unknown as CraftOrderService,
    prisma: {
      character: { findMany: vi.fn().mockResolvedValue(balances) },
    } as unknown as PrismaService,
    worldState: { listSessions: vi.fn().mockReturnValue(sessions) } as unknown as WorldStateService,
    publisher: { emit } as unknown as WorldEventsPublisher,
    emit,
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('CraftOrderExpirationService', () => {
  it('sweeps immediately, drains full batches and pushes synchronized balances', async () => {
    vi.useFakeTimers();
    const expireOrders = vi
      .fn()
      .mockResolvedValueOnce(100)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);
    const session = {
      socketId: 'socket-1',
      characterId: 'character-1',
      silver: 10,
      stateRevision: 4,
      dirty: false,
    };
    const { craftOrders, prisma, worldState, publisher, emit } = dependencies(
      expireOrders,
      [session],
      [{ id: 'character-1', silver: 250 }],
    );
    const service = new CraftOrderExpirationService(
      craftOrders,
      prisma,
      worldState,
      publisher,
    );

    service.onModuleInit();
    await vi.waitFor(() => expect(expireOrders).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(session.silver).toBe(250));
    expect(session.stateRevision).toBe(5);
    expect(session.dirty).toBe(true);
    expect(emit).toHaveBeenCalledWith('socket-1', 'character:currencyUpdated', {
      characterId: 'character-1',
      currency: 'SILVER',
      amount: 240,
      balance: 250,
    });

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
    const { craftOrders, prisma, worldState, publisher } = dependencies(expireOrders);
    const service = new CraftOrderExpirationService(
      craftOrders,
      prisma,
      worldState,
      publisher,
    );

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
