import { Injectable } from '@nestjs/common';
import type { CurrencyBalance, CurrencyType } from '../../common/domain/game.types.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';

const MAX_CURRENCY_AMOUNT = 2_147_483_647;
const OPERATION_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;
const REASON_PATTERN = /^[A-Z0-9_:-]{2,96}$/;

export class CharacterNotFoundError extends Error {
  constructor() {
    super('Character not found');
  }
}

export class CharacterOwnershipError extends Error {
  constructor() {
    super('Character does not belong to the authenticated user');
  }
}

export class InsufficientCurrencyError extends Error {
  constructor(
    readonly currency: CurrencyType,
    readonly requestedAmount: number,
  ) {
    super(`Insufficient ${currency.toLowerCase()} balance`);
  }
}

export interface CurrencyMutationInput {
  userId: string;
  characterId: string;
  operationId: string;
  currency: CurrencyType;
  amount: number;
  reason: string;
  metadata?: Prisma.InputJsonValue;
}

interface CurrencyRow {
  silver: number;
  gold: number;
}

interface LedgerRow extends CurrencyRow {
  operationId: string;
}

@Injectable()
export class CharacterCurrencyService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(userId: string, characterId: string): Promise<Required<CurrencyBalance>> {
    const rows = await this.prisma.$queryRaw<CurrencyRow[]>`
      SELECT "silver", "gold"
      FROM "Character"
      WHERE "id" = ${characterId}::uuid
        AND "userId" = ${userId}::uuid
      LIMIT 1
    `;

    if (rows[0]) return rows[0];
    await this.throwCharacterAccessError(userId, characterId);
  }

  async credit(input: CurrencyMutationInput): Promise<Required<CurrencyBalance>> {
    return this.mutate(input, 'CREDIT');
  }

  async debit(input: CurrencyMutationInput): Promise<Required<CurrencyBalance>> {
    return this.mutate(input, 'DEBIT');
  }

  async debitWithinTransaction<T>(
    input: CurrencyMutationInput,
    applyPurchase: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<{ balance: Required<CurrencyBalance>; result: T }> {
    this.validateInput(input);

    return this.prisma.$transaction(async (transaction) => {
      const balance = await this.mutateInTransaction(transaction, input, 'DEBIT');
      const result = await applyPurchase(transaction);
      return { balance, result };
    });
  }

  private async mutate(
    input: CurrencyMutationInput,
    direction: 'CREDIT' | 'DEBIT',
  ): Promise<Required<CurrencyBalance>> {
    this.validateInput(input);
    return this.prisma.$transaction((transaction) =>
      this.mutateInTransaction(transaction, input, direction),
    );
  }

  private async mutateInTransaction(
    transaction: Prisma.TransactionClient,
    input: CurrencyMutationInput,
    direction: 'CREDIT' | 'DEBIT',
  ): Promise<Required<CurrencyBalance>> {
    const existing = await transaction.$queryRaw<LedgerRow[]>`
      SELECT c."silver", c."gold", l."operationId"
      FROM "CharacterCurrencyLedger" l
      JOIN "Character" c ON c."id" = l."characterId"
      WHERE l."characterId" = ${input.characterId}::uuid
        AND l."operationId" = ${input.operationId}
        AND c."userId" = ${input.userId}::uuid
      LIMIT 1
    `;
    if (existing[0]) {
      return { silver: existing[0].silver, gold: existing[0].gold };
    }

    const delta = direction === 'CREDIT' ? input.amount : -input.amount;
    const rows = input.currency === 'SILVER'
      ? await transaction.$queryRaw<CurrencyRow[]>`
          UPDATE "Character"
          SET "silver" = "silver" + ${delta}
          WHERE "id" = ${input.characterId}::uuid
            AND "userId" = ${input.userId}::uuid
            AND "silver" + ${delta} BETWEEN 0 AND ${MAX_CURRENCY_AMOUNT}
          RETURNING "silver", "gold"
        `
      : await transaction.$queryRaw<CurrencyRow[]>`
          UPDATE "Character"
          SET "gold" = "gold" + ${delta}
          WHERE "id" = ${input.characterId}::uuid
            AND "userId" = ${input.userId}::uuid
            AND "gold" + ${delta} BETWEEN 0 AND ${MAX_CURRENCY_AMOUNT}
          RETURNING "silver", "gold"
        `;

    const balance = rows[0];
    if (!balance) {
      const owned = await transaction.$queryRaw<Array<{ exists: boolean; owned: boolean }>>`
        SELECT TRUE AS "exists", ("userId" = ${input.userId}::uuid) AS "owned"
        FROM "Character"
        WHERE "id" = ${input.characterId}::uuid
        LIMIT 1
      `;
      if (!owned[0]) throw new CharacterNotFoundError();
      if (!owned[0].owned) throw new CharacterOwnershipError();
      if (direction === 'DEBIT') throw new InsufficientCurrencyError(input.currency, input.amount);
      throw new RangeError('Currency balance would exceed the supported database range');
    }

    const balanceAfter = input.currency === 'SILVER' ? balance.silver : balance.gold;
    await transaction.$executeRaw`
      INSERT INTO "CharacterCurrencyLedger"
        ("characterId", "operationId", "currency", "direction", "amount", "reason", "balanceAfter", "metadata")
      VALUES
        (${input.characterId}::uuid, ${input.operationId}, ${input.currency}::"CurrencyType", ${direction}::"CurrencyDirection", ${input.amount}, ${input.reason}, ${balanceAfter}, ${input.metadata ?? {} as Prisma.InputJsonValue}::jsonb)
    `;

    return balance;
  }

  private validateInput(input: CurrencyMutationInput): void {
    if (input.currency !== 'SILVER' && input.currency !== 'GOLD') {
      throw new TypeError('Unsupported currency type');
    }
    if (!Number.isInteger(input.amount) || input.amount <= 0 || input.amount > MAX_CURRENCY_AMOUNT) {
      throw new RangeError(`Currency amount must be an integer between 1 and ${MAX_CURRENCY_AMOUNT}`);
    }
    if (!OPERATION_ID_PATTERN.test(input.operationId)) {
      throw new TypeError('Invalid currency operationId');
    }
    if (!REASON_PATTERN.test(input.reason)) {
      throw new TypeError('Invalid currency operation reason');
    }
  }

  private async throwCharacterAccessError(userId: string, characterId: string): Promise<never> {
    const rows = await this.prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT "userId"
      FROM "Character"
      WHERE "id" = ${characterId}::uuid
      LIMIT 1
    `;
    if (!rows[0]) throw new CharacterNotFoundError();
    if (rows[0].userId !== userId) throw new CharacterOwnershipError();
    throw new CharacterNotFoundError();
  }
}
