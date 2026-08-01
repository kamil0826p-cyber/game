import { describe, expect, it, vi } from 'vitest';
import { combatActionSchema } from '../src/contracts/socket.schemas.js';
import type { CombatSnapshot } from '../src/contracts/socket.events.js';
import { mapTacticalCombatError } from '../src/modules/combat/combat-error.mapper.js';
import { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';

function tacticalSnapshot(): CombatSnapshot {
  return {
    combatId: '00000000-0000-4000-8000-000000000999',
    status: 'ACTIVE',
    phase: 'TURN',
    contractVersion: 1,
    zoneType: 'PVP',
    mapId: 'map-a',
    createdAt: 1_000,
    startedAt: 1_000,
    turnNumber: 2,
    activeActorId: 'character-b',
    initiatorActorId: 'character-a',
    recipientActorId: 'character-b',
    lastSequence: 1,
    turnOrder: ['character-a', 'character-b'],
    turnPolicy: { decisionMs: 10_000, reactionMs: 4_000, tutorialDecisionMs: 15_000 },
    participants: [
      {
        actorId: 'character-a',
        teamId: 'team-a',
        kind: 'PLAYER',
        characterId: 'character-a',
        name: 'A',
        characterClass: 'WARRIOR',
        level: 10,
        outfitKey: 'warrior',
        hp: 100,
        maxHp: 100,
        energy: 50,
        maxEnergy: 50,
        shield: 0,
        statuses: [],
        skills: [],
        formationSlot: 0,
        formationLine: 'FRONT',
      },
      {
        actorId: 'character-b',
        teamId: 'team-b',
        kind: 'PLAYER',
        characterId: 'character-b',
        name: 'B',
        characterClass: 'MAGE',
        level: 10,
        outfitKey: 'mage',
        hp: 80,
        maxHp: 80,
        energy: 70,
        maxEnergy: 70,
        shield: 0,
        statuses: [],
        skills: [],
        formationSlot: 0,
        formationLine: 'FRONT',
      },
    ],
    recentActions: [
      {
        sequence: 1,
        actorId: 'character-a',
        targetActorId: 'character-a',
        action: 'SKILL',
        tacticalAction: 'GUARD',
        skillKey: 'tactical:guard',
        label: 'Guard',
        animationKey: 'tactical-guard',
        visual: {
          castEffectKey: 'tactical:cast',
          impactEffectKey: 'tactical:impact',
          accentColor: '#fff',
        },
        results: [
          {
            targetActorId: 'character-a',
            hpDelta: 0,
            energyDelta: 0,
            shieldDelta: 0,
            shieldAbsorbed: 0,
            dodged: false,
            statusesApplied: [],
            statusesRemoved: [],
          },
        ],
        occurredAt: 11_000,
        decisionTimeMs: 10_000,
        timedOut: true,
      },
    ],
    legalActions: [],
  };
}

describe('tactical combat command contract', () => {
  it('accepts actor context for no-target tactical commands in both gateways', () => {
    expect(combatActionSchema.parse({
      requestId: 'guard-1',
      combatId: '00000000-0000-4000-8000-000000000999',
      expectedTurn: 2,
      action: 'GUARD',
      targetActorId: 'character-a',
    })).toMatchObject({ action: 'GUARD', targetActorId: 'character-a' });

    expect(combatActionSchema.parse({
      requestId: 'interrupt-1',
      combatId: '00000000-0000-4000-8000-000000000999',
      expectedTurn: 2,
      action: 'INTERRUPT',
      telegraphId: '00000000-0000-4000-8000-000000000998',
      targetActorId: 'character-b',
    })).toMatchObject({ action: 'INTERRUPT', targetActorId: 'character-b' });
  });

  it('maps stale turns and tactical legality errors to stable public errors', () => {
    expect(mapTacticalCombatError(new Error('COMBAT_STALE_TURN'))).toMatchObject({
      code: 'COMBAT_NOT_YOUR_TURN',
      details: { reason: 'COMBAT_STALE_TURN' },
    });
    expect(mapTacticalCombatError(new Error('COMBAT_TARGET_ILLEGAL'))).toMatchObject({
      code: 'COMBAT_ACTION_INVALID',
      details: { reason: 'COMBAT_TARGET_ILLEGAL' },
    });
  });

  it('tracks a server timeout resolution once even when broadcast to both players', () => {
    const first = { characterId: 'character-a' };
    const second = { characterId: 'character-b' };
    const world = {
      getByCharacterId: vi.fn((actorId: string) =>
        actorId === 'character-a' ? first : actorId === 'character-b' ? second : undefined,
      ),
      getBySocketId: vi.fn(() => undefined),
    };
    const analytics = {
      combatActionAccepted: vi.fn().mockResolvedValue(undefined),
      combatStarted: vi.fn().mockResolvedValue(undefined),
      combatResolved: vi.fn().mockResolvedValue(undefined),
    };
    const emit = vi.fn();
    const publisher = new WorldEventsPublisher(world as never, analytics as never);
    publisher.bind({ to: vi.fn(() => ({ emit })) } as never);
    const snapshot = tacticalSnapshot();

    publisher.emit('socket-a', 'combat:updated', snapshot);
    publisher.emit('socket-b', 'combat:updated', snapshot);

    expect(analytics.combatActionAccepted).toHaveBeenCalledTimes(1);
    expect(analytics.combatActionAccepted).toHaveBeenCalledWith(
      first,
      snapshot,
      expect.objectContaining({ action: 'GUARD', targetActorId: 'character-a' }),
    );
  });
});
