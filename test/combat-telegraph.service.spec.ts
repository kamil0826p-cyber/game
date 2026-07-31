import { describe, expect, it } from 'vitest';
import type { CombatSnapshot } from '../src/contracts/socket.events.js';
import { CombatTelegraphService } from '../src/modules/combat/combat-telegraph.service.js';

const definition = {
  key: 'heavy-cast',
  resolveAfterTurns: 2,
  counterKinds: ['INTERRUPT', 'GUARD'] as const,
  publicMetadata: { severity: 'high' },
};

const snapshot = (status: CombatSnapshot['status']): CombatSnapshot =>
  ({
    combatId: 'combat-1',
    status,
    zoneType: 'PVE',
    mapId: 'map-1',
    createdAt: 1,
    turnNumber: 1,
    initiatorActorId: 'player-1',
    recipientActorId: 'mob-1',
    teams: [],
    participants: [],
    recentActions: [],
  }) as unknown as CombatSnapshot;

describe('CombatTelegraphService', () => {
  it('stores only public data in decorated snapshots and resolves the hidden command later', () => {
    const service = new CombatTelegraphService();
    const telegraph = service.prepare(
      'combat-1',
      'mob-1',
      'player-1',
      { action: 'SKILL', skillKey: 'heavy-strike', targetActorId: 'player-1' },
      4,
      definition,
    );

    const decorated = service.decorate(snapshot('ACTIVE'));
    expect(decorated.telegraphs[0]).toMatchObject({
      id: telegraph.id,
      createdTurn: 4,
      resolvesOnTurn: 6,
    });
    expect(JSON.stringify(decorated)).not.toContain('"command"');
    expect(service.resolveReady('combat-1', 'mob-1', 5)).toBeUndefined();
    expect(service.resolveReady('combat-1', 'mob-1', 6)).toEqual({
      action: 'SKILL',
      skillKey: 'heavy-strike',
      targetActorId: 'player-1',
    });
    expect(service.list('combat-1')).toEqual([]);
  });

  it('clears telegraphs from terminal snapshots', () => {
    const service = new CombatTelegraphService();
    service.prepare(
      'combat-1',
      'mob-1',
      'player-1',
      { action: 'SKILL', skillKey: 'heavy-strike', targetActorId: 'player-1' },
      1,
      definition,
    );
    expect(service.decorate(snapshot('FINISHED')).telegraphs).toEqual([]);
    expect(service.list('combat-1')).toEqual([]);
  });

  it('accepts only configured counters', () => {
    const service = new CombatTelegraphService();
    const telegraph = service.prepare(
      'combat-1',
      'mob-1',
      'player-1',
      { action: 'SKILL', skillKey: 'heavy-strike', targetActorId: 'player-1' },
      1,
      definition,
    );

    expect(service.counter('combat-1', telegraph.id, 'CLEANSE')).toBe(false);
    expect(service.counter('combat-1', telegraph.id, 'INTERRUPT')).toBe(true);
    expect(service.list('combat-1')).toEqual([]);
  });

  it('removes telegraphs when either the caster or target leaves', () => {
    const service = new CombatTelegraphService();
    service.prepare(
      'combat-1',
      'mob-1',
      'player-1',
      { action: 'SKILL', skillKey: 'heavy-strike', targetActorId: 'player-1' },
      1,
      definition,
    );
    service.removeActor('combat-1', 'player-1');
    expect(service.list('combat-1')).toEqual([]);
  });

  it('does not allow multiple hidden preparations for one actor', () => {
    const service = new CombatTelegraphService();
    service.prepare(
      'combat-1',
      'mob-1',
      'player-1',
      { action: 'SKILL', skillKey: 'heavy-strike', targetActorId: 'player-1' },
      1,
      definition,
    );
    expect(() =>
      service.prepare(
        'combat-1',
        'mob-1',
        'player-1',
        { action: 'SKILL', skillKey: 'other', targetActorId: 'player-1' },
        2,
        definition,
      ),
    ).toThrow(/already has an active telegraph/i);
  });
});
