import { describe, expect, it, vi } from 'vitest';
import { PvpService } from '../src/modules/pvp/pvp.service.js';

const COMBAT_ID = '00000000-0000-4000-8000-000000000030';
const WINNER = '00000000-0000-4000-8000-000000000001';
const LOSER = '00000000-0000-4000-8000-000000000002';

function settlementHarness() {
  let settlementInserted = false;
  const rewardWrites: string[] = [];
  const transaction = {
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (sql.includes('INSERT INTO "PvpCombatSettlement"')) {
        if (settlementInserted) return Promise.resolve([]);
        settlementInserted = true;
        return Promise.resolve([{ combatId: COMBAT_ID }]);
      }
      if (sql.includes('FROM "PvpObjectiveContribution"')) return Promise.resolve([]);
      return Promise.resolve([]);
    }),
    $executeRaw: vi.fn((strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (sql.includes('INSERT INTO "PvpRewardLedger"')) rewardWrites.push(sql);
      return Promise.resolve(1);
    }),
  };
  const prisma = {
    $queryRaw: vi.fn().mockResolvedValue([
      {
        combatId: COMBAT_ID,
        zoneType: 'PVP',
        kind: 'OPEN_WORLD',
        modeKey: null,
        ratingPool: null,
        attackerTeam: [WINNER],
        defenderTeam: [LOSER],
        legalAggression: true,
        rewardMultiplier: 1,
        bountyId: null,
      },
    ]),
    $transaction: vi.fn((operation: (tx: typeof transaction) => unknown) => operation(transaction)),
  };
  return { service: new PvpService(prisma as never), rewardWrites };
}

describe('PvP settlement idempotency', () => {
  it('writes rewards once for repeated settlement delivery of the same combat ID', async () => {
    const test = settlementHarness();
    const input = {
      combatId: COMBAT_ID,
      winnerTeamId: 'team-a',
      finishReason: 'DEFEATED',
      teams: [
        { teamId: 'team-a', actorIds: [WINNER] },
        { teamId: 'team-b', actorIds: [LOSER] },
      ] as const,
      events: [],
      startedAt: 1_000,
      finishedAt: 2_000,
    };

    await expect(test.service.settleCombat(input)).resolves.toMatchObject({ applied: true });
    await expect(test.service.settleCombat(input)).resolves.toMatchObject({ applied: false });
    expect(test.rewardWrites).toHaveLength(2);
  });
});
