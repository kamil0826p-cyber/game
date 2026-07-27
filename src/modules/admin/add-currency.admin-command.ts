import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { AdminCommandError } from './admin-command.types.js';
import type {
  AdminCommandContext,
  AdminCommandHandler,
  AdminCommandMutationResult,
  AdminCurrency,
} from './admin-command.types.js';

const MAX_DATABASE_INT = 2_147_483_647;
const MAX_GRANT_AMOUNT = 1_000_000_000;
const CHARACTER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 _-]*$/u;
const POSITIVE_INTEGER_PATTERN = /^[1-9][0-9]*$/u;

export interface AddCurrencyArguments {
  characterName: string;
  currency: AdminCurrency;
  amount: number;
}

export function parseAddCurrencyArguments(rawArguments: string): AddCurrencyArguments {
  const tokens = rawArguments.split(' ').filter(Boolean);
  if (tokens.length < 3) {
    throw new AdminCommandError('ADMIN_COMMAND_INVALID', 'Użycie: /add <nazwa postaci> silver|gold <ilość>');
  }

  const amountToken = tokens.at(-1)!;
  const currencyToken = tokens.at(-2)!.toUpperCase();
  const characterName = tokens.slice(0, -2).join(' ');

  if (
    characterName.length < 3 ||
    characterName.length > 20 ||
    !CHARACTER_NAME_PATTERN.test(characterName) ||
    (currencyToken !== 'SILVER' && currencyToken !== 'GOLD') ||
    !POSITIVE_INTEGER_PATTERN.test(amountToken)
  ) {
    throw new AdminCommandError('ADMIN_COMMAND_INVALID', 'Użycie: /add <nazwa postaci> silver|gold <ilość>');
  }

  const amount = Number(amountToken);
  if (!Number.isSafeInteger(amount) || amount > MAX_GRANT_AMOUNT) {
    throw new AdminCommandError('ADMIN_COMMAND_INVALID', `Ilość musi być dodatnią liczbą całkowitą nie większą niż ${MAX_GRANT_AMOUNT}.`, { maximum: MAX_GRANT_AMOUNT });
  }

  return { characterName, currency: currencyToken, amount };
}

@Injectable()
export class AddCurrencyAdminCommand implements AdminCommandHandler {
  readonly name = 'add';

  async execute(
    transaction: Prisma.TransactionClient,
    context: AdminCommandContext,
    rawArguments: string,
  ): Promise<AdminCommandMutationResult> {
    const input = parseAddCurrencyArguments(rawArguments);
    const operationId = `admin:add:${context.actorUserId}:${context.requestId}`;

    const lockRows = await transaction.$queryRaw<Array<{ locked: boolean }>>`
      WITH operation_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtextextended(${operationId}, 0))
      )
      SELECT TRUE AS "locked"
      FROM operation_lock
    `;
    if (lockRows.length !== 1 || lockRows[0]?.locked !== true) {
      throw new AdminCommandError('ADMIN_COMMAND_LOCK_FAILED', 'Nie udało się zabezpieczyć wykonania komendy.');
    }

    const previous = await transaction.characterCurrencyLedger.findFirst({
      where: { operationId },
      include: { character: { select: { id: true, name: true } } },
    });
    if (previous) {
      const metadata = this.metadata(previous.metadata);
      if (
        previous.character.name !== input.characterName ||
        previous.currency !== input.currency ||
        previous.direction !== 'CREDIT' ||
        previous.amount !== input.amount ||
        metadata.actorUserId !== context.actorUserId ||
        metadata.actorCharacterId !== context.actorCharacterId ||
        metadata.requestId !== context.requestId
      ) {
        throw new AdminCommandError('ADMIN_COMMAND_REQUEST_CONFLICT', 'Ten identyfikator żądania został już użyty dla innej komendy.');
      }

      return this.result(previous.character.id, previous.character.name, input.currency, input.amount, previous.balanceAfter);
    }

    const target = await transaction.character.findUnique({
      where: { realmId_name: { realmId: context.realmId, name: input.characterName } },
      select: { id: true, name: true },
    });
    if (!target) {
      throw new AdminCommandError('ADMIN_TARGET_NOT_FOUND', `Nie znaleziono postaci ${input.characterName} w tym świecie.`, { characterName: input.characterName });
    }

    const updated = input.currency === 'SILVER'
      ? await transaction.character.updateMany({
          where: { id: target.id, silver: { lte: MAX_DATABASE_INT - input.amount } },
          data: { silver: { increment: input.amount } },
        })
      : await transaction.character.updateMany({
          where: { id: target.id, gold: { lte: MAX_DATABASE_INT - input.amount } },
          data: { gold: { increment: input.amount } },
        });
    if (updated.count !== 1) {
      throw new AdminCommandError('ADMIN_CURRENCY_LIMIT', 'Saldo postaci przekroczyłoby bezpieczny limit bazy danych.');
    }

    const balances = await transaction.character.findUniqueOrThrow({
      where: { id: target.id },
      select: { silver: true, gold: true },
    });
    const balance = input.currency === 'SILVER' ? balances.silver : balances.gold;

    await transaction.characterCurrencyLedger.create({
      data: {
        characterId: target.id,
        operationId,
        currency: input.currency,
        direction: 'CREDIT',
        amount: input.amount,
        reason: 'ADMIN_CHAT_COMMAND_ADD',
        balanceAfter: balance,
        metadata: {
          actorUserId: context.actorUserId,
          actorCharacterId: context.actorCharacterId,
          requestId: context.requestId,
          command: this.name,
          targetCharacterName: target.name,
        },
      },
    });

    return this.result(target.id, target.name, input.currency, input.amount, balance);
  }

  private result(
    targetCharacterId: string,
    characterName: string,
    currency: AdminCurrency,
    amount: number,
    balance: number,
  ): AdminCommandMutationResult {
    return {
      message: `Dodano ${amount} ${currency === 'SILVER' ? 'srebra' : 'złota'} postaci ${characterName}. Nowe saldo: ${balance}.`,
      targetCharacterId,
      currencyUpdate: { currency, amount, balance },
    };
  }

  private metadata(value: Prisma.JsonValue): Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
