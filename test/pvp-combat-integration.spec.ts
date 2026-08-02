import { describe, expect, it, vi } from 'vitest';
import type { CombatSnapshot } from '../src/contracts/socket.events.js';
import { PvpCombatIntegrationService } from '../src/modules/combat/pvp-combat.integration.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';

function session(characterId: string, userId: string, x: number): PlayerSession {
  return {
    characterId,
    userId,
    socketId: `${characterId}-socket`,
    connectionId: `${characterId}-connection`,
    realmId: '00000000-0000-4000-8000-000000000010',
    mapId: '00000000-0000-4000-8000-000000000020',
    x,
    y: 1,
    level: 20,
    activeInWorld: true,
    combatState: 'IDLE',
    connectedAt: 1_000,
  } as PlayerSession;
}

function activeSnapshot(zoneType: 'PVP' | 'OUTLAW' | 'SAFE' = 'PVP'): CombatSnapshot {
  return {
    combatId: '00000000-0000-4000-8000-000000000030',
    status: 'ACTIVE',
    zoneType,
    mapId: '00000000-0000-4000-8000-000000000020',
    createdAt: 2_000,
    startedAt: 2_000,
    turnNumber: 1,
    initiatorActorId: '00000000-0000-4000-8000-000000000001',
    recipientActorId: '00000000-0000-4000-8000-000000000002',
    participants: [] as never,
    teams: [
      {
        teamId: 'team-a',
        anchorActorId: '00000000-0000-4000-8000-000000000001',
        actorIds: ['00000000-0000-4000-8000-000000000001'],
      },
      {
        teamId: 'team-b',
        anchorActorId: '00000000-0000-4000-8000-000000000002',
        actorIds: ['00000000-0000-4000-8000-000000000002'],
      },
    ],
    recentActions: [],
  } as CombatSnapshot;
}

function harness(zoneType: 'PVP' | 'OUTLAW' | 'SAFE' = 'PVP') {
  const attacker = session(
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000101',
    1,
  );
  const defender = session(
    '00000000-0000-4000-8000-000000000002',
    '00000000-0000-4000-8000-000000000102',
    2,
  );
  const snapshot = activeSnapshot(zoneType);
  const combats = {
    request: vi.fn().mockResolvedValue(
      zoneType !== 'PVP' ? { ...snapshot, status: 'REQUESTED', startedAt: undefined } : snapshot,
    ),
    respond: vi.fn().mockResolvedValue(snapshot),
    getActive: vi.fn().mockResolvedValue({ ...snapshot, status: 'REQUESTED' }),
    leave: vi.fn().mockResolvedValue({ ...snapshot, status: 'FINISHED' }),
  };
  const pvp = {
    evaluateCombat: vi.fn().mockResolvedValue({
      allowed: true,
      legalAggression: true,
      notorietyDeltaOnAttack: 0,
      rewardMultiplier: 1,
      normalized: false,
    }),
    recordApprovedCombat: vi.fn().mockResolvedValue(undefined),
    settleCombat: vi.fn().mockResolvedValue({ applied: true }),
  };
  const world = {
    getByCharacterId: vi.fn((id: string) =>
      id === attacker.characterId ? attacker : id === defender.characterId ? defender : undefined,
    ),
  };
  let listener: ((snapshot: CombatSnapshot) => void) | undefined;
  const publisher = {
    onCombatUpdated: vi.fn((next: (value: CombatSnapshot) => void) => {
      listener = next;
      return vi.fn();
    }),
  };
  const integration = new PvpCombatIntegrationService(
    combats as never,
    pvp as never,
    { getMap: vi.fn().mockResolvedValue({ zoneType }) } as never,
    { getSnapshot: vi.fn().mockReturnValue({ group: null }) } as never,
    { hasActive: vi.fn().mockResolvedValue(false) } as never,
    { isOccupied: vi.fn().mockReturnValue(false) } as never,
    world as never,
    publisher as never,
  );
  return { attacker, defender, snapshot, combats, pvp, integration, getListener: () => listener };
}

describe('PvP combat integration', () => {
  it('preflights a PVP-zone attack before starting and records the approved combat', async () => {
    const test = harness('PVP');
    await test.integration.request(test.attacker, test.defender.characterId);
    expect(test.pvp.evaluateCombat.mock.invocationCallOrder[0]).toBeLessThan(
      test.combats.request.mock.invocationCallOrder[0]!,
    );
    expect(test.pvp.recordApprovedCombat).toHaveBeenCalledWith(
      expect.objectContaining({
        combatId: test.snapshot.combatId,
        kind: 'OPEN_WORLD',
        attackers: [test.attacker],
        defenders: [test.defender],
      }),
    );
  });

  it('keeps an OUTLAW duel consensual and evaluates protections when accepted', async () => {
    const test = harness('OUTLAW');
    const requested = await test.integration.request(test.attacker, test.defender.characterId);
    expect(requested.status).toBe('REQUESTED');
    expect(test.pvp.evaluateCombat).not.toHaveBeenCalled();

    await test.integration.respond(test.defender, requested.combatId, true);
    expect(test.pvp.evaluateCombat).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'DUEL', consented: true }),
    );
    expect(test.pvp.recordApprovedCombat).toHaveBeenCalledTimes(1);
  });

  it('keeps a SAFE-zone duel consensual instead of treating it as open aggression', async () => {
    const test = harness('SAFE');
    const requested = await test.integration.request(test.attacker, test.defender.characterId);
    expect(requested.status).toBe('REQUESTED');
    expect(test.pvp.evaluateCombat).not.toHaveBeenCalled();

    await test.integration.respond(test.defender, requested.combatId, true);
    expect(test.pvp.evaluateCombat).toHaveBeenCalledWith(
      expect.objectContaining({ zoneType: 'SAFE', kind: 'DUEL', consented: true }),
    );
    expect(test.pvp.recordApprovedCombat).toHaveBeenCalledTimes(1);
  });

  it('settles a finished combat through the internal combat update hook', async () => {
    const test = harness('PVP');
    test.integration.onModuleInit();
    const listener = test.getListener();
    expect(listener).toBeTypeOf('function');
    listener?.({
      ...test.snapshot,
      status: 'FINISHED',
      winnerTeamId: 'team-a',
      finishReason: 'DEFEATED',
      finishedAt: 5_000,
    });
    await vi.waitFor(() => expect(test.pvp.settleCombat).toHaveBeenCalledTimes(1));
    expect(test.pvp.settleCombat).toHaveBeenCalledWith(
      expect.objectContaining({ combatId: test.snapshot.combatId, winnerTeamId: 'team-a' }),
    );
  });
});
