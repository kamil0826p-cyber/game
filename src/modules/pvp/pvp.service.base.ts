import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { PvpBountyView } from './pvp.service.shared.js';

export abstract class PvpServiceBase {
  constructor(protected readonly prisma: PrismaService) {}

  protected abstract expireBounties(now: number): Promise<void>;
  protected abstract listBounties(viewerCharacterId: string): Promise<PvpBountyView[]>;
  protected abstract recordRiskSignal(
    transaction: Prisma.TransactionClient,
    combatId: string | undefined,
    characterId: string | undefined,
    signalType: string,
    riskScore: number,
    operationId: string,
    evidence: Record<string, unknown>,
  ): Promise<void>;

  protected abstract enqueueOutbox(
    database: Prisma.TransactionClient | PrismaService,
    characterId: string | null,
    eventType: string,
    operationId: string,
    payload: Record<string, unknown>,
  ): Promise<void>;
  protected async requireOwnedCharacter(
    database: Prisma.TransactionClient | PrismaService,
    userId: string,
    characterId: string,
  ): Promise<{ id: string; userId: string }> {
    const rows = await database.$queryRaw<Array<{ id: string; userId: string }>>`
      SELECT "id", "userId" FROM "Character"
      WHERE "id" = ${characterId}::uuid
        AND "userId" = ${userId}::uuid
      LIMIT 1
    `;
    if (!rows[0]) throw new Error('PVP_CHARACTER_FORBIDDEN');
    return rows[0];
  }

  protected async requireCharacter(
    database: Prisma.TransactionClient | PrismaService,
    characterId: string,
  ): Promise<{ id: string; userId: string }> {
    const rows = await database.$queryRaw<Array<{ id: string; userId: string }>>`
      SELECT "id", "userId" FROM "Character"
      WHERE "id" = ${characterId}::uuid
      LIMIT 1
    `;
    if (!rows[0]) throw new Error('PVP_CHARACTER_NOT_FOUND');
    return rows[0];
  }

  protected average(values: readonly number[], fallback: number): number {
    return values.length === 0
      ? fallback
      : values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  protected stringArray(value: unknown): string[] {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
      ? value
      : [];
  }
}
