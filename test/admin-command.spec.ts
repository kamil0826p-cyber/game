import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import {
  AddCurrencyAdminCommand,
  parseAddCurrencyArguments,
} from '../src/modules/admin/add-currency.admin-command.js';
import { parseAdminCommand } from '../src/modules/admin/admin-command.parser.js';
import { AdminCommandError } from '../src/modules/admin/admin-command.types.js';

describe('admin command parser', () => {
  it('parses a command and preserves arguments', () => {
    expect(parseAdminCommand('/add Sir Test silver 25')).toEqual({ name: 'add', rawArguments: 'Sir Test silver 25' });
  });

  it('rejects malformed command names', () => {
    expect(() => parseAdminCommand('/123')).toThrow(AdminCommandError);
  });
});

describe('/add currency arguments', () => {
  it('parses silver and multi-word character names', () => {
    expect(parseAddCurrencyArguments('Sir Test silver 25')).toEqual({ characterName: 'Sir Test', currency: 'SILVER', amount: 25 });
  });

  it('parses gold case-insensitively', () => {
    expect(parseAddCurrencyArguments('Mage GOLD 9')).toEqual({ characterName: 'Mage', currency: 'GOLD', amount: 9 });
  });

  it.each(['Mage silver 0', 'Mage silver -1', 'Mage copper 1', 'Mage silver 1.5', 'Mage silver 1000000001'])('rejects unsafe input: %s', (input) => {
    expect(() => parseAddCurrencyArguments(input)).toThrow(AdminCommandError);
  });
});

describe('AddCurrencyAdminCommand', () => {
  it('accepts a supported boolean result from the advisory lock query', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ locked: true }]);
    const transaction = {
      $queryRaw: queryRaw,
      characterCurrencyLedger: {
        findFirst: vi.fn().mockResolvedValue({
          character: { id: 'character-id', name: 'Mage' },
          currency: 'SILVER',
          direction: 'CREDIT',
          amount: 25,
          balanceAfter: 125,
          metadata: {
            actorUserId: 'admin-user',
            actorCharacterId: 'admin-character',
            requestId: 'request-1',
          },
        }),
      },
    } as unknown as Prisma.TransactionClient;

    const result = await new AddCurrencyAdminCommand().execute(
      transaction,
      {
        actorUserId: 'admin-user',
        actorCharacterId: 'admin-character',
        realmId: 'realm-id',
        requestId: 'request-1',
        locale: 'pl',
      },
      'Mage silver 25',
    );

    expect(queryRaw).toHaveBeenCalledOnce();
    expect(result.currencyUpdate).toEqual({ currency: 'SILVER', amount: 25, balance: 125 });
  });

  it('fails closed when the lock query does not return confirmation', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as Prisma.TransactionClient;

    await expect(
      new AddCurrencyAdminCommand().execute(
        transaction,
        {
          actorUserId: 'admin-user',
          actorCharacterId: 'admin-character',
          realmId: 'realm-id',
          requestId: 'request-2',
          locale: 'pl',
        },
        'Mage gold 1',
      ),
    ).rejects.toMatchObject({ code: 'ADMIN_COMMAND_LOCK_FAILED' });
  });
});
