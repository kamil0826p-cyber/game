import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import { CharacterCurrencyService } from '../src/modules/characters/character-currency.service.js';

describe('CharacterCurrencyService', () => {
  it('supplies a UUID when inserting a ledger row without a database id default', async () => {
    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ silver: 25, gold: 0 }]);
    const executeRaw = vi.fn().mockResolvedValue(1);
    const transaction = { $queryRaw: queryRaw, $executeRaw: executeRaw };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<unknown>) =>
        operation(transaction),
      ),
    } as unknown as PrismaService;

    const balance = await new CharacterCurrencyService(prisma).credit({
      userId: 'd64a7b0e-c44d-4cf3-9281-bf352b431ed3',
      characterId: 'e42645f3-dd4c-47f1-b943-26ca4543fc53',
      operationId: 'test:credit:request-1',
      currency: 'SILVER',
      amount: 25,
      reason: 'TEST_CREDIT',
    });

    expect(balance).toEqual({ silver: 25, gold: 0 });
    expect(executeRaw).toHaveBeenCalledOnce();
    const [sql, ledgerId] = executeRaw.mock.calls[0] as unknown as [TemplateStringsArray, string];
    expect(sql.join('?')).toContain(
      '("id", "characterId", "operationId", "currency", "direction", "amount", "reason", "balanceAfter", "metadata")',
    );
    expect(ledgerId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
