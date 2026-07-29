import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyedSerialExecutor } from '../src/common/utils/keyed-serial-executor.js';
import type { MapService } from '../src/modules/maps/map.service.js';
import type { MovementCoordinatorService } from '../src/modules/movement/movement-coordinator.service.js';
import type { PlayerPersistenceService } from '../src/modules/persistence/player-persistence.service.js';
import type { TradeService } from '../src/modules/player/trade/trade.service.js';
import type { SkillService } from '../src/modules/skills/skill.service.js';
import { CombatService } from '../src/modules/combat/combat.service.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';
import type { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import type { WorldStateService } from '../src/modules/world/world-state.service.js';

const session = (
  characterId: string,
  x: number,
  overrides: Partial<PlayerSession> = {},
): PlayerSession =>
  ({
    socketId: `socket-${characterId}`,
    connectionId: `connection-${characterId}`,
    characterId,
    userId: `user-${characterId}`,
    realmId: 'realm-a',
    name: characterId,
    characterClass: 'WARRIOR',
    level: 10,
    experience: 0,
    silver: 0,
    gold: 0,
    outfitKey: 'warrior-recruit',
    mapId: 'map-a',
    x,
    y: 4,
    direction: 'EAST',
    combatState: 'IDLE',
    hp: 140,
    maxHp: 140,
    energy: 80,
    maxEnergy: 80,
    strength: 18,
    agility: 10,
    intelligence: 5,
    armor: 14,
    locale: 'en',
    viewport: { halfWidth: 10, halfHeight: 8 },
    connectedAt: 0,
    nextMoveAllowedAt: 0,
    stateRevision: 0,
    persistedRevision: 0,
    dirty: false,
    activeInWorld: true,
    visibleCharacterIds: new Set(),
    watcherCharacterIds: new Set(),
    ...overrides,
  }) as PlayerSession;

const services: CombatService[] = [];

const harness = (zoneType: 'SAFE' | 'OUTLAW' | 'PVP') => {
  const first = session('first', 4);
  const second = session('second', 5);
  const third = session('third', 6);
  const sessions = new Map([
    [first.characterId, first],
    [second.characterId, second],
    [third.characterId, third],
  ]);
  const publisher = { emit: vi.fn() };
  const combat = new CombatService(
    {
      getMap: vi.fn(async () => ({
        id: 'map-a',
        realmId: 'realm-a',
        key: 'map-a',
        name: 'Map',
        width: 20,
        height: 20,
        zoneType,
        spawn: { x: 1, y: 1 },
        version: 1,
        tiledData: {},
        collision: new Uint8Array(),
        portalsByTile: new Map(),
      })),
    } as unknown as MapService,
    {
      quiesce: vi.fn(async (_session: PlayerSession, task: () => unknown) => task()),
    } as unknown as MovementCoordinatorService,
    {
      persistSession: vi.fn(async (active: PlayerSession) => ({
        characterId: active.characterId,
        connectionId: active.connectionId,
        revision: active.stateRevision,
      })),
    } as unknown as PlayerPersistenceService,
    { hasActive: vi.fn(async () => false) } as unknown as TradeService,
    {
      getSnapshot: vi.fn(async () => ({
        characterClass: 'WARRIOR',
        characterLevel: 10,
        points: { earned: 1, spent: 0, available: 1 },
        skills: [],
      })),
      persistCooldowns: vi.fn(async () => undefined),
    } as unknown as SkillService,
    {
      getByCharacterId: (id: string) => sessions.get(id),
      toPublicState: (active: PlayerSession) => ({
        characterId: active.characterId,
        name: active.name,
        characterClass: active.characterClass,
        level: active.level,
        outfitKey: active.outfitKey,
        mapId: active.mapId,
        x: active.x,
        y: active.y,
        direction: active.direction,
        combatState: active.combatState,
      }),
      markPersisted: vi.fn(),
    } as unknown as WorldStateService,
    publisher as unknown as WorldEventsPublisher,
    new KeyedSerialExecutor(),
  );
  services.push(combat);
  return { combat, first, second, third, publisher };
};

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.onModuleDestroy()));
});

describe('CombatService PVP policy', () => {
  it('rejects combat on a SAFE map', async () => {
    const { combat, first, second, publisher } = harness('SAFE');

    await expect(
      combat.request(first.userId, first.characterId, second.characterId),
    ).rejects.toMatchObject({ code: 'COMBAT_SAFE_ZONE' });
    expect(publisher.emit).not.toHaveBeenCalled();
  });

  it('creates a consent request in an OUTLAW zone without entering battle', async () => {
    const { combat, first, second, publisher } = harness('OUTLAW');

    const snapshot = await combat.request(first.userId, first.characterId, second.characterId);

    expect(snapshot.status).toBe('REQUESTED');
    expect(first.combatState).toBe('IDLE');
    expect(second.combatState).toBe('IDLE');
    expect(publisher.emit).toHaveBeenCalledWith(second.socketId, 'combat:requested', snapshot);
  });

  it('starts immediately and marks both players IN_BATTLE on a PVP map', async () => {
    const { combat, first, second } = harness('PVP');

    const snapshot = await combat.request(first.userId, first.characterId, second.characterId);

    expect(snapshot.status).toBe('ACTIVE');
    expect(first.combatState).toBe('IN_BATTLE');
    expect(second.combatState).toBe('IN_BATTLE');
  });

  it('rejects a third player attacking someone who is already in combat', async () => {
    const { combat, first, second, third } = harness('PVP');
    await combat.request(first.userId, first.characterId, second.characterId);

    await expect(
      combat.request(third.userId, third.characterId, second.characterId),
    ).rejects.toMatchObject({ code: 'COMBAT_BUSY' });
  });
});
