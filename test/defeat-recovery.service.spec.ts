import { describe, expect, it, vi } from 'vitest';
import type { CombatParticipantPayload, CombatSnapshot } from '../src/contracts/socket.events.js';
import { DefeatRecoveryService } from '../src/modules/combat/defeat-recovery.service.js';

const participant = (
  characterId: string,
  hp: number,
): CombatParticipantPayload => ({
  actorId: characterId,
  kind: 'PLAYER',
  characterId,
  name: characterId,
  characterClass: 'WARRIOR',
  level: 1,
  outfitKey: 'warrior-recruit',
  hp,
  maxHp: 100,
  energy: 10,
  maxEnergy: 10,
  shield: 0,
  statuses: [],
  skills: [],
});

const finishedSnapshot = (): CombatSnapshot => ({
  combatId: 'combat-finished-1',
  status: 'FINISHED',
  zoneType: 'OUTLAW',
  mapId: 'greenfields-id',
  createdAt: 1,
  startedAt: 2,
  finishedAt: 3,
  turnNumber: 4,
  winnerActorId: 'alive',
  finishReason: 'DEFEATED',
  initiatorActorId: 'dead',
  recipientActorId: 'alive',
  participants: [participant('dead', 0), participant('alive', 12)],
  recentActions: [],
});

describe('DefeatRecoveryService', () => {
  it('waits for combat release, moves only defeated players and deduplicates terminal snapshots', async () => {
    const hospital = {
      id: 'hospital-id',
      key: 'hospital',
      name: 'Mroczna Lecznica',
      width: 24,
      height: 18,
      zoneType: 'SAFE',
      version: 1,
      spawn: { x: 12, y: 15 },
    };
    const deadSession = {
      socketId: 'socket-dead',
      connectionId: 'connection-dead',
      characterId: 'dead',
      locale: 'pl',
      activeInWorld: true,
      combatState: 'IN_BATTLE',
      mapId: 'greenfields-id',
      x: 8,
      y: 8,
      direction: 'SOUTH',
      stateRevision: 1,
      persistedRevision: 1,
      dirty: false,
    };
    const aliveSession = {
      ...deadSession,
      socketId: 'socket-alive',
      connectionId: 'connection-alive',
      characterId: 'alive',
      combatState: 'IDLE',
      x: 9,
    };

    const maps = {
      getMapByKey: vi.fn().mockResolvedValue(hospital),
      findNearestWalkable: vi.fn().mockReturnValue({ x: 12, y: 15 }),
    };
    const npcs = { getMapNpcs: vi.fn().mockResolvedValue([]) };
    const persistence = {
      persistSession: vi.fn().mockImplementation(async (session: typeof deadSession) => ({
        characterId: session.characterId,
        connectionId: session.connectionId,
        revision: session.stateRevision,
      })),
    };
    const visibility = {
      afterMovement: vi.fn().mockReturnValue([]),
    };
    const publisher = {
      onCombatUpdated: vi.fn().mockReturnValue(vi.fn()),
      emit: vi.fn(),
    };
    const sessions = new Map([
      ['dead', deadSession],
      ['alive', aliveSession],
    ]);
    const world = {
      getByCharacterId: vi.fn((characterId: string) => sessions.get(characterId)),
      updatePosition: vi.fn(
        (
          session: typeof deadSession,
          next: typeof hospital.spawn & { mapId: string; direction: 'NORTH' },
        ) => {
          const previous = {
            mapId: session.mapId,
            x: session.x,
            y: session.y,
            direction: session.direction,
          };
          session.mapId = next.mapId;
          session.x = next.x;
          session.y = next.y;
          session.direction = next.direction;
          session.stateRevision += 1;
          session.dirty = true;
          return previous;
        },
      ),
      toSelfState: vi.fn((session: typeof deadSession) => ({
        characterId: session.characterId,
        mapId: session.mapId,
        x: session.x,
        y: session.y,
      })),
      markPersisted: vi.fn(),
    };

    const service = new DefeatRecoveryService(
      maps as never,
      npcs as never,
      persistence as never,
      visibility as never,
      publisher as never,
      world as never,
    );

    const snapshot = finishedSnapshot();
    setTimeout(() => {
      deadSession.combatState = 'IDLE';
    }, 5);
    await Promise.all([
      service.processCombatUpdate(snapshot),
      service.processCombatUpdate(snapshot),
    ]);

    expect(maps.getMapByKey).toHaveBeenCalledTimes(1);
    expect(world.updatePosition).toHaveBeenCalledTimes(1);
    expect(deadSession).toMatchObject({
      mapId: 'hospital-id',
      x: 12,
      y: 15,
      direction: 'NORTH',
    });
    expect(aliveSession.mapId).toBe('greenfields-id');
    expect(persistence.persistSession).toHaveBeenCalledWith(deadSession, 'combat');
    expect(publisher.emit).toHaveBeenCalledWith(
      'socket-dead',
      'world:mapChanged',
      expect.objectContaining({
        map: expect.objectContaining({ key: 'hospital' }),
        self: expect.objectContaining({ mapId: 'hospital-id', x: 12, y: 15 }),
      }),
    );
    expect(publisher.emit).toHaveBeenCalledWith(
      'socket-dead',
      'notification',
      expect.objectContaining({ code: 'DEFEAT_RECOVERY' }),
    );

    service.onModuleDestroy();
  });

  it('ignores active combat updates and finished combats without a defeated player', async () => {
    const maps = { getMapByKey: vi.fn() };
    const service = new DefeatRecoveryService(
      maps as never,
      {} as never,
      {} as never,
      {} as never,
      { onCombatUpdated: vi.fn().mockReturnValue(vi.fn()) } as never,
      {} as never,
    );
    const active = { ...finishedSnapshot(), status: 'ACTIVE' as const };
    const noDefeat = {
      ...finishedSnapshot(),
      combatId: 'combat-finished-2',
      participants: [participant('dead', 1), participant('alive', 12)] as [
        CombatParticipantPayload,
        CombatParticipantPayload,
      ],
    };

    await service.processCombatUpdate(active);
    await service.processCombatUpdate(noDefeat);

    expect(maps.getMapByKey).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });
});
