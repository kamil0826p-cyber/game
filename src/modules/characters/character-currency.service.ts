import { Injectable } from '@nestjs/common';
import type { CurrencyBalance, CurrencyType } from '../../common/domain/game.types.js';
import { PrismaService } from '../../database/prisma.service.js';

export class InsufficientCurrencyError extends Error {
  constructor(
    readonly currency: CurrencyType,
    readonly requestedAmount: number,
  ) {
    super(`Insufficient ${currency.toLowerCase()} balance`);
  }
}

@Injectable()
export class CharacterCurrencyService {
  constructor(private readonly prisma: PrismaService) {}

  async getBalance(characterId: string): Promise<Required<CurrencyBalance>> {
    const rows = await this.prisma.$queryRaw<Array<{ silver: number; gold: number }>>`
      SELECT "silver", "gold"
      FROM "Character"
      WHERE "id" = ${characterId}::uuid
      LIMIT 1
    `;

    return rows[0] ?? { silver: 0, gold: 0 };
  }

  async add(characterId: string, currency: CurrencyType, amount: number): Promise<Required<CurrencyBalance>> {
    this.assertPositiveInteger(amount);
    const column = currency === 'SILVER' ? 'silver' : 'gold';

    await this.prisma.$executeRawUnsafe(
      `UPDATE "Character" SET "${column}" = "${column}" + $1 WHERE "id" = $2::uuid`,
      amount,
      characterId,
    );

    return this.getBalance(characterId);
  }

  async subtract(characterId: string, currency: CurrencyType, amount: number): Promise<Required<CurrencyBalance>> {
    this.assertPositiveInteger(amount);
    const column = currency === 'SILVER' ? 'silver' : 'gold';

    const changed = await this.prisma.$executeRawUnsafe(
      `UPDATE "Character" SET "${column}" = "${column}" - $1 WHERE "id" = $2::uuid AND "${column}" >= $1`,
      amount,
      characterId,
    );

    if (changed !== 1) {
      throw new InsufficientCurrencyError(currency, amount);
    }

    return this.getBalance(characterId);
  }

  private assertPositiveInteger(amount: number): void {
    if (!Number.isSafeInteger(amount) || amount <= 0) {
      throw new RangeError('Currency amount must be a positive safe integer');
    }
  }
}