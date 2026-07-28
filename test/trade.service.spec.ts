import { describe, expect, it, vi } from 'vitest';
import { GAME_ERROR_CODES, GameError } from '../src/common/errors/game.error.js';
import { TradeService } from '../src/modules/trade/trade.service.js';

const player = (characterId: string, x = 10, y = 10) => ({ characterId, mapId: 'map-1', x, y, activeInWorld: true });

const createService = (options?: { first?: ReturnType<typeof player>; second?: ReturnType<typeof player>; activeTrade?: boolean }) => {
  const first = options?.first ?? player('11111111-1111-4111-8111-111111111111');
  const second = options?.second ?? player('22222222-2222-4222-8222-222222222222', 11, 10);
  const world = {
    getByCharacterId: vi.fn((id: string) => id === first.characterId ? first : id === second.characterId ? second : undefined),
  };
  const tx = {
    $queryRawUnsafe: vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }]),
    tradeSession: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(options?.activeTrade ? { id: 'trade-1' } : null),
      create: vi.fn().mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' }),
      findUnique: vi.fn().mockResolvedValue({
        id: '33333333-3333-4333-8333-333333333333', status: 'REQUESTED', expiresAt: new Date(Date.now() + 30_000),
        initiatorCharacterId: first.characterId, recipientCharacterId: second.characterId,
        initiatorAccepted: false, recipientAccepted: false, initiatorSilver: 0, recipientSilver: 0,
        initiator: { id: first.characterId, name: 'First' }, recipient: { id: second.characterId, name: 'Second' }, offers: [],
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (operation: (transaction: typeof tx) => unknown) => operation(tx)),
  };
  return { service: new TradeService(prisma as never, world as never), prisma, tx, first, second };
};

const expectCode = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    throw new Error('Expected operation to reject.');
  } catch (error) {
    expect(error).toBeInstanceOf(GameError);
    expect((error as GameError).code).toBe(code);
  }
};

describe('TradeService', () => {
  it('rejects trading with the same character before opening a transaction', async () => {
    const { service, prisma, first } = createService();
    await expectCode(service.request(first.characterId, first.characterId), GAME_ERROR_CODES.INVALID_PAYLOAD);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('requires both players to be online, on the same map, and within radius', async () => {
    const first = player('11111111-1111-4111-8111-111111111111');
    const second = player('22222222-2222-4222-8222-222222222222', 13, 10);
    const { service, prisma } = createService({ first, second });
    await expectCode(service.request(first.characterId, second.characterId), GAME_ERROR_CODES.TRADE_TOO_FAR);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('serializes the participant pair and rejects a second active trade', async () => {
    const { service, tx, first, second } = createService({ activeTrade: true });
    await expectCode(service.request(first.characterId, second.characterId), GAME_ERROR_CODES.TRADE_BUSY);
    expect(tx.$queryRawUnsafe).toHaveBeenCalledOnce();
    expect(tx.tradeSession.create).not.toHaveBeenCalled();
  });

  it('creates a request when both players are available', async () => {
    const { service, tx, first, second } = createService();
    const snapshot = await service.request(first.characterId, second.characterId);
    expect(snapshot.status).toBe('REQUESTED');
    expect(snapshot.initiator.characterId).toBe(first.characterId);
    expect(snapshot.recipient.characterId).toBe(second.characterId);
    expect(tx.tradeSession.create).toHaveBeenCalledOnce();
  });

  it('rejects negative silver and duplicate item identifiers before touching the database', async () => {
    const { service, prisma, first } = createService();
    await expectCode(service.setOffer('33333333-3333-4333-8333-333333333333', first.characterId, [], -1), GAME_ERROR_CODES.INVALID_PAYLOAD);
    await expectCode(service.setOffer('33333333-3333-4333-8333-333333333333', first.characterId, [{ itemId: 'item-1', quantity: 1 }, { itemId: 'item-1', quantity: 1 }], 0), GAME_ERROR_CODES.INVALID_PAYLOAD);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
