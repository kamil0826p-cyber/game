import { describe, expect, it, vi } from 'vitest';
import { TradeGateway } from '../src/modules/trade/trade.gateway.js';

const trade = {
  id: '11111111-1111-4111-8111-111111111111',
  status: 'REQUESTED' as const,
  expiresAt: Date.now() + 30_000,
  selfCharacterId: 'initiator',
  initiator: { characterId: 'initiator', name: 'Alice', silver: 0, accepted: false },
  recipient: { characterId: 'recipient', name: 'Bob', silver: 0, accepted: false },
  items: [],
};

describe('TradeGateway', () => {
  it('delivers an incoming request through the bound world publisher with a recipient-specific snapshot', async () => {
    const trades = {
      request: vi.fn().mockResolvedValue(trade),
      snapshot: vi.fn(async (_tradeId: string, viewerId: string) => ({ ...trade, selfCharacterId: viewerId })),
    };
    const sessions = new Map([
      ['initiator', { socketId: 'socket-a' }],
      ['recipient', { socketId: 'socket-b' }],
    ]);
    const world = {
      getBySocketId: vi.fn().mockReturnValue({ characterId: 'initiator', activeInWorld: true }),
      getByCharacterId: vi.fn((id: string) => sessions.get(id)),
    };
    const movement = { runSerialized: vi.fn(async (_session: unknown, operation: () => Promise<unknown>) => operation()) };
    const localization = { translate: vi.fn((key: string) => key) };
    const publisher = { emit: vi.fn() };
    const gateway = new TradeGateway(trades as never, world as never, movement as never, localization as never, publisher as never);
    const client = { id: 'socket-a', data: { sessionState: 'IN_WORLD', locale: 'pl' } };

    const response = await gateway.request(client as never, {
      requestId: 'trade-request-1',
      targetCharacterId: '22222222-2222-4222-8222-222222222222',
    });

    expect(response.ok).toBe(true);
    expect(trades.snapshot).toHaveBeenCalledWith(trade.id, 'recipient');
    expect(publisher.emit).toHaveBeenCalledWith(
      'socket-b',
      'trade:requested',
      expect.objectContaining({ selfCharacterId: 'recipient' }),
    );
  });
});
