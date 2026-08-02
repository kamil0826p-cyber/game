import { describe, expect, it, vi } from 'vitest';
import { PvpPolicyViolationError, PvpService } from '../src/modules/pvp/pvp.service.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';

const ATTACKER = '00000000-0000-4000-8000-000000000001';
const DEFENDER = '00000000-0000-4000-8000-000000000002';

function session(
  characterId: string,
  userId: string,
  level: number,
  connectedAt: number,
): PlayerSession {
  return {
    characterId,
    userId,
    level,
    connectedAt,
    activeInWorld: true,
  } as PlayerSession;
}

function serviceWithProfile(profile: {
  optedIn?: boolean;
  spawnProtectedUntil?: Date | null;
  reconnectProtectedUntil?: Date | null;
  defeatProtectedUntil?: Date | null;
  combatCooldownUntil?: Date | null;
}) {
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    $queryRaw: vi.fn((strings: TemplateStringsArray) => {
      const sql = strings.join(' ');
      if (sql.includes('FROM "PvpProfile"')) {
        return Promise.resolve([
          {
            characterId: DEFENDER,
            optedIn: profile.optedIn ?? false,
            notoriety: 0,
            notorietyChangedAt: new Date(0),
            spawnProtectedUntil: profile.spawnProtectedUntil ?? null,
            reconnectProtectedUntil: profile.reconnectProtectedUntil ?? null,
            defeatProtectedUntil: profile.defeatProtectedUntil ?? null,
            combatCooldownUntil: profile.combatCooldownUntil ?? null,
          },
        ]);
      }
      if (sql.includes('FROM "PvpOpponentHistory"')) {
        return Promise.resolve([{ count: 0n, lastDefeatedAt: null }]);
      }
      return Promise.resolve([]);
    }),
  };
  const prisma = {
    $transaction: vi.fn((operation: (tx: typeof transaction) => unknown) => operation(transaction)),
  };
  return new PvpService(prisma as never);
}

async function expectBlocked(
  service: PvpService,
  now: number,
  defender: PlayerSession,
  reason: PvpPolicyViolationError['reason'],
): Promise<void> {
  await expect(
    service.evaluateCombat({
      zoneType: 'PVP',
      kind: 'OPEN_WORLD',
      attackers: [session(ATTACKER, '00000000-0000-4000-8000-000000000101', 20, 0)],
      defenders: [defender],
      consented: false,
      now,
    }),
  ).rejects.toMatchObject({ reason });
}

describe('PvP service protection integration', () => {
  it('enforces newcomer protection from the persisted opt-in profile', async () => {
    const now = 100_000;
    await expectBlocked(
      serviceWithProfile({ optedIn: false }),
      now,
      session(DEFENDER, '00000000-0000-4000-8000-000000000102', 5, 0),
      'NEWCOMER_PROTECTION',
    );
  });

  it('enforces persisted spawn protection', async () => {
    const now = 100_000;
    await expectBlocked(
      serviceWithProfile({ optedIn: true, spawnProtectedUntil: new Date(now + 10_000) }),
      now,
      session(DEFENDER, '00000000-0000-4000-8000-000000000102', 20, 0),
      'SPAWN_PROTECTION',
    );
  });

  it('enforces persisted reconnect protection after the in-memory spawn window', async () => {
    const now = 100_000;
    await expectBlocked(
      serviceWithProfile({
        optedIn: true,
        reconnectProtectedUntil: new Date(now + 10_000),
      }),
      now,
      session(DEFENDER, '00000000-0000-4000-8000-000000000102', 20, 0),
      'RECONNECT_PROTECTION',
    );
  });
});
