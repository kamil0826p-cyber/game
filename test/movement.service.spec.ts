import { describe, expect, it, vi } from 'vitest';
import type { GameConfigService } from '../src/config/game-config.service.js';
import type { LocalizationService } from '../src/i18n/localization.service.js';
import type { MapService } from '../src/modules/maps/map.service.js';
import { MovementService } from '../src/modules/movement/movement.service.js';
import type { PlayerPersistenceService } from '../src/modules/persistence/player-persistence.service.js';
import { capturePlayerState } from '../src/modules/persistence/player-state-snapshot.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';
import type { VisibilityService } from '../src/modules/world/visibility.service.js';
import type { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import type { WorldStateService } from '../src/modules/world/world-state.service.js';
import { createRuntimeMap } from './helpers/runtime-map.js';

const createSession = (): PlayerSession => ({
  socketId: 'socket-a',
  connectionId: 'connection-a',
  characterId: 'character-a',
  userId: 'user-a',
  realmId: 'realm-a',
  name: 'Hero',
  characterClass: 'WARRIOR',
  level: 1,
  experience: 0,
  silver: 0,
  gold: 0,
  outfitKey: 'warrior-recruit',
  mapId: 'map-a',
  x: 1,
  y: 1,
  direction: 'SOUTH',
  combatState: 'IDLE',
  hp: 100,
  maxHp: 100,
  energy: 50,
  maxEnergy: 50,
  strength: 10,
  agility: 5,
  intelligence: 2,
  armor: 5,
  locale: 'en',
  viewport: { halfWidth: 10, halfHeight: 8 },
  connectedAt: 0,
  nextMoveAllowedAt: 0,
  stateRevision: 0,
  persistedRevision: 0,
  dirty: false,
  activeInWorld: true,
  visibleCharacterIds: new Set<string>(),
  watcherCharacterIds: new Set<string>(),
});

const inside = (map: ReturnType<typeof createRuntimeMap>, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < map.width && y < map.height;

const collision = (map: ReturnType<typeof createRuntimeMap>, x: number, y: number): boolean =>
  !inside(map, x, y) || map.collision[y * map.width + x] === 1;

describe('MovementService', () => {
  it('rejects a collision tile without mutating the session', async () => {
    const session = createSession();
    const map = createRuntimeMap({ blocked: [{ x: 2, y: 1 }] });
    const updatePosition = vi.fn();
    const emitted: Array<{ event: string; payload: unknown }> = [];

    const service = new MovementService(
      { values: { MOVE_STEP_MS: 200 } } as unknown as GameConfigService,
      {
        getMap: async () => map,
        isInside: inside,
        isCollision: collision,
        getPortalAt: () => undefined,
      } as unknown as MapService,
      {
        getByCharacterId: () => session,
        isOccupied: () => false,
        updatePosition,
      } as unknown as WorldStateService,
      { afterMovement: () => [] } as unknown as VisibilityService,
      {
        emit: (_socketId: string, event: string, payload: unknown) => {
          emitted.push({ event, payload });
        },
      } as unknown as WorldEventsPublisher,
      { translate: (key: string) => key } as unknown as LocalizationService,
      {} as PlayerPersistenceService,
    );

    const result = await service.performStep(session, 'EAST', 'DIRECT', 'request-1');
    expect(result.accepted).toBe(false);
    if (!result.accepted) {
      expect(result.error.code).toBe('MOVE_COLLISION');
    }
    expect(updatePosition).not.toHaveBeenCalled();
    expect({ mapId: session.mapId, x: session.x, y: session.y }).toEqual({
      mapId: 'map-a',
      x: 1,
      y: 1,
    });
    expect(emitted.map((entry) => entry.event)).toEqual(['movement:rejected']);
  });

  it('transitions through a portal and starts a checkpoint without delaying movement', async () => {
    const session = createSession();
    const portal = {
      id: 'portal-a',
      sourceMapId: 'map-a',
      sourceX: 2,
      sourceY: 1,
      destinationMapId: 'map-b',
      targetX: 3,
      targetY: 3,
    };
    const sourceMap = createRuntimeMap({ id: 'map-a', portals: [portal] });
    const destinationMap = createRuntimeMap({ id: 'map-b', key: 'map-b' });
    const emitted: string[] = [];
    const persistSnapshot = vi.fn(
      () => new Promise<ReturnType<typeof capturePlayerState>>(() => undefined),
    );

    const worldState = {
      getByCharacterId: () => session,
      isOccupied: () => false,
      updatePosition: (
        target: PlayerSession,
        next: { mapId: string; x: number; y: number; direction: 'EAST' },
      ) => {
        const previous = {
          mapId: target.mapId,
          x: target.x,
          y: target.y,
          direction: target.direction,
        };
        target.mapId = next.mapId;
        target.x = next.x;
        target.y = next.y;
        target.direction = next.direction;
        target.stateRevision += 1;
        target.dirty = true;
        return previous;
      },
      toSelfState: () => ({ characterId: session.characterId }),
      markPersisted: vi.fn(),
    } as unknown as WorldStateService;

    const service = new MovementService(
      { values: { MOVE_STEP_MS: 200 } } as unknown as GameConfigService,
      {
        getMap: async (mapId: string) => (mapId === 'map-a' ? sourceMap : destinationMap),
        isInside: inside,
        isCollision: collision,
        getPortalAt: (_map: unknown, x: number, y: number) =>
          x === portal.sourceX && y === portal.sourceY ? portal : undefined,
      } as unknown as MapService,
      worldState,
      { afterMovement: () => [] } as unknown as VisibilityService,
      {
        emit: (_socketId: string, event: string) => {
          emitted.push(event);
        },
      } as unknown as WorldEventsPublisher,
      { translate: (key: string) => key } as unknown as LocalizationService,
      {
        capture: capturePlayerState,
        persistSnapshot,
      } as unknown as PlayerPersistenceService,
    );

    const result = await service.performStep(session, 'EAST', 'DIRECT', 'request-2');
    expect(result.accepted).toBe(true);
    expect({ mapId: session.mapId, x: session.x, y: session.y }).toEqual({
      mapId: 'map-b',
      x: 3,
      y: 3,
    });
    expect(persistSnapshot).toHaveBeenCalledOnce();
    expect(persistSnapshot).toHaveBeenCalledWith(expect.any(Object), 'portal');
    expect(emitted).toEqual(['movement:committed', 'world:mapChanged']);
  });
});