import { describe, expect, it, vi } from 'vitest';
import { AnalyticsTrackingService } from '../src/analytics/analytics-tracking.service.js';
import type { CombatSnapshot } from '../src/contracts/socket.events.js';
import { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';

function session(characterId: string, socketId: string): PlayerSession {
  return {
    socketId,
    connectionId: `connection-${characterId}`,
    characterId,
    userId: `00000000-0000-0000-0000-00000000000${characterId === 'character-a' ? '1' : '2'}`,
    realmId: '00000000-0000-0000-0000-000000000010',
    name: characterId,
    characterClass: 'WARRIOR',
    gender: 'MALE',
    level: 5,
    experience: 0,
    silver: 0,
    gold: 0,
    outfitKey: 'warrior',
    mapId: '00000000-0000-0000-0000-000000000020',
    x: 1,
    y: 1,
    direction: 'SOUTH',
    combatState: 'IN_BATTLE',
    hp: 100,
    maxHp: 100,
    energy: 50,
    maxEnergy: 50,
    strength: 10,
    agility: 10,
    intelligence: 10,
    armor: 5,
    locale: 'pl',
    viewport: { halfWidth: 12, halfHeight: 8 },
    connectedAt: 1,
    nextMoveAllowedAt: 0,
    stateRevision: 1,
    persistedRevision: 0,
    dirty: true,
    activeInWorld: true,
    visibleCharacterIds: new Set(),
    watcherCharacterIds: new Set(),
  };
}

function snapshot(status: CombatSnapshot['status'] = 'ACTIVE'): CombatSnapshot {
  return {
    combatId: 'combat-1',
    status,
    zoneType: 'PVP',
    mapId: '00000000-0000-0000-0000-000000000020',
    createdAt: 1_000,
    startedAt: 2_000,
    ...(status === 'FINISHED' ? { finishedAt: 8_000, finishReason: 'DEFEATED' as const } : {}),
    turnNumber: status === 'FINISHED' ? 4 : 1,
    activeActorId: 'character-a',
    initiatorActorId: 'character-a',
    recipientActorId: 'character-b',
    participants: [
      {
        actorId: 'character-a', kind: 'PLAYER', characterId: 'character-a', name: 'A',
        characterClass: 'WARRIOR', level: 5, outfitKey: 'warrior', hp: 100, maxHp: 100,
        energy: 50, maxEnergy: 50, shield: 0, statuses: [], skills: [],
      },
      {
        actorId: 'character-b', kind: 'PLAYER', characterId: 'character-b', name: 'B',
        characterClass: 'MAGE', level: 5, outfitKey: 'mage', hp: 80, maxHp: 80,
        energy: 70, maxEnergy: 70, shield: 0, statuses: [], skills: [],
      },
    ],
    recentActions: [],
  };
}

describe('authoritative combat analytics', () => {
  it('tracks lifecycle broadcasts for every participant but resolves a combat once', () => {
    const first = session('character-a', 'socket-a');
    const second = session('character-b', 'socket-b');
    const analytics = {
      combatStarted: vi.fn().mockResolvedValue(undefined),
      combatResolved: vi.fn().mockResolvedValue(undefined),
    };
    const world = {
      getBySocketId: vi.fn((socketId: string) => socketId === 'socket-a' ? first : second),
    };
    const emit = vi.fn();
    const publisher = new WorldEventsPublisher(world as never, analytics as never);
    publisher.bind({ to: vi.fn(() => ({ emit })) } as never);

    publisher.emit('socket-a', 'combat:updated', snapshot('ACTIVE'));
    publisher.emit('socket-b', 'combat:updated', snapshot('ACTIVE'));
    publisher.emit('socket-b', 'combat:updated', snapshot('FINISHED'));
    publisher.emit('socket-a', 'combat:updated', snapshot('FINISHED'));

    expect(analytics.combatStarted).toHaveBeenCalledTimes(2);
    expect(analytics.combatResolved).toHaveBeenCalledTimes(1);
    expect(analytics.combatResolved).toHaveBeenCalledWith(first, expect.objectContaining({ status: 'FINISHED' }));
  });

  it('selects the matching action instead of a later status tick', async () => {
    const events = { appendInTransaction: vi.fn().mockResolvedValue(undefined) };
    const tracking = new AnalyticsTrackingService(events as never);
    const current = snapshot('ACTIVE');
    current.turnNumber = 3;
    current.recentActions = [
      {
        sequence: 7,
        actorId: 'character-a',
        targetActorId: 'character-b',
        action: 'SKILL',
        skillKey: 'warrior-power-strike',
        label: 'Power strike',
        animationKey: 'power-strike',
        visual: { castEffectKey: 'cast', impactEffectKey: 'impact', accentColor: '#fff' },
        results: [{
          targetActorId: 'character-b', hpDelta: -20, energyDelta: 0, shieldDelta: 0,
          shieldAbsorbed: 0, dodged: false, statusesApplied: [], statusesRemoved: [],
        }],
        occurredAt: 5_000,
      },
      {
        sequence: 8,
        actorId: 'character-b',
        targetActorId: 'character-b',
        action: 'STATUS_TICK',
        label: 'Tick',
        animationKey: 'tick',
        visual: { castEffectKey: 'cast', impactEffectKey: 'impact', accentColor: '#fff' },
        results: [],
        occurredAt: 5_001,
      },
    ];

    await tracking.combatActionAccepted(session('character-a', 'socket-a'), current, {
      action: 'SKILL',
      skillKey: 'warrior-power-strike',
      targetActorId: 'character-b',
    });

    expect(events.appendInTransaction).toHaveBeenCalledWith(expect.objectContaining({
      operationId: 'combat-action:combat-1:7',
      occurredAt: new Date(5_000),
      payload: expect.objectContaining({
        action: 'SKILL',
        skillKey: 'warrior-power-strike',
        results: [expect.objectContaining({ hpDelta: -20 })],
      }),
    }));
  });
});
