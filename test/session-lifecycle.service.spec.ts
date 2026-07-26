import { describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../src/auth/auth-context.interface.js';
import type { PersistedCharacterState } from '../src/common/domain/game.types.js';
import type { GameConfigService } from '../src/config/game-config.service.js';
import type { GameSocket } from '../src/contracts/socket.events.js';
import type { LocalizationService } from '../src/i18n/localization.service.js';
import type { CharacterService } from '../src/modules/characters/character.service.js';
import type { MapService } from '../src/modules/maps/map.service.js';
import type { MovementCoordinatorService } from '../src/modules/movement/movement-coordinator.service.js';
import type { MovementService } from '../src/modules/movement/movement.service.js';
import type { PlayerPersistenceService } from '../src/modules/persistence/player-persistence.service.js';
import type { RealmService } from '../src/modules/realm/realm.service.js';
import { SessionClaimExecutor } from '../src/modules/realtime/session-claim.executor.js';
import { SessionLifecycleService } from '../src/modules/realtime/session-lifecycle.service.js';
import type { VisibilityService } from '../src/modules/world/visibility.service.js';
import type { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import type { WorldStateService } from '../src/modules/world/world-state.service.js';
import { SpatialIndexService } from '../src/modules/world/spatial-index.service.js';
import { WorldStateService as RealWorldStateService } from '../src/modules/world/world-state.service.js';
import { capturePlayerState } from '../src/modules/persistence/player-state-snapshot.js';
import { createRuntimeMap } from './helpers/runtime-map.js';

const characterState = (
  overrides: Partial<PersistedCharacterState> = {},
): PersistedCharacterState => ({
  id: 'character-a',
  userId: 'user-a',
  realmId: 'realm-a',
  name: 'Hero',
  characterClass: 'WARRIOR',
  level: 1,
  experience: 0,
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
  stateVersion: 3,
  lastSavedAt: new Date(0),
  ...overrides,
});

describe('SessionLifecycleService', () => {
  it('does not register a world session after the socket closes during loading', async () => {
    let resolveUser!: () => void;
    const userGate = new Promise<void>((resolve) => {
      resolveUser = resolve;
    });
    const addSession = vi.fn();
    const client = {
      id: 'socket-a',
      connected: true,
      data: {
        auth: {
          firebaseUid: 'firebase-a',
          tokenIssuedAt: 1,
        } satisfies AuthContext,
      },
      handshake: { auth: {}, query: {} },
      emit: vi.fn(),
    } as unknown as GameSocket;

    const service = new SessionLifecycleService(
      { values: { MOVE_STEP_MS: 200 } } as unknown as GameConfigService,
      {
        synchronizeFirebaseUser: async () => {
          await userGate;
          return { id: 'user-a', firebaseUid: 'firebase-a' };
        },
        findCharacterForCurrentRealm: async () => undefined,
      } as unknown as CharacterService,
      {
        getCurrentRealm: async () => ({
          id: 'realm-a',
          slug: 'world-1',
          name: 'World 1',
          defaultMapId: 'map-a',
        }),
      } as unknown as RealmService,
      {} as MapService,
      {} as MovementCoordinatorService,
      {} as MovementService,
      {} as PlayerPersistenceService,
      {
        getBySocketId: () => undefined,
        addSession,
      } as unknown as WorldStateService,
      {} as VisibilityService,
      {} as WorldEventsPublisher,
      {
        resolveLocale: () => 'en',
      } as unknown as LocalizationService,
      new SessionClaimExecutor(),
    );

    const initialization = service.initializeConnection(client);
    client.connected = false;
    resolveUser();

    await expect(initialization).rejects.toMatchObject({ code: 'SESSION_NOT_READY' });
    expect(addSession).not.toHaveBeenCalled();
    expect(client.emit).not.toHaveBeenCalled();
  });

  it('reloads the final persisted takeover position before registering the new session', async () => {
    const config = {
      values: {
        MOVE_STEP_MS: 200,
        SPATIAL_BUCKET_SIZE: 8,
        FOV_HALF_WIDTH: 12,
        FOV_HALF_HEIGHT: 8,
        MAX_FOV_HALF_WIDTH: 24,
        MAX_FOV_HALF_HEIGHT: 18,
      },
    } as unknown as GameConfigService;
    const spatial = new SpatialIndexService(config);
    const world = new RealWorldStateService(config, spatial);
    const staleCharacter = characterState();
    let databaseCharacter = staleCharacter;
    const existing = world.createSession({
      socketId: 'socket-old',
      connectionId: 'connection-old',
      locale: 'en',
      character: staleCharacter,
      mapId: 'map-a',
      x: 8,
      y: 9,
    });
    existing.stateRevision = 11;
    existing.dirty = true;
    world.addSession(existing);

    const map = createRuntimeMap({ id: 'map-a', key: 'map-a', width: 16, height: 16 });
    const publisher = {
      emit: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as WorldEventsPublisher;
    const persistence = {
      flushDetachedCharacter: vi.fn(async () => undefined),
      capture: capturePlayerState,
      queueDetachedSnapshot: vi.fn(async (snapshot: ReturnType<typeof capturePlayerState>) => {
        databaseCharacter = characterState({
          mapId: snapshot.mapId,
          x: snapshot.x,
          y: snapshot.y,
          direction: snapshot.direction,
          stateVersion: snapshot.revision,
        });
      }),
      persistSnapshot: vi.fn(async (snapshot: ReturnType<typeof capturePlayerState>) => snapshot),
    } as unknown as PlayerPersistenceService;
    const movement = {
      quiesce: vi.fn(async (_session: unknown, task: () => unknown) => task()),
    } as unknown as MovementCoordinatorService;
    const client = {
      id: 'socket-new',
      connected: true,
      data: {
        auth: {
          firebaseUid: 'firebase-a',
          tokenIssuedAt: 1,
        } satisfies AuthContext,
      },
      handshake: { auth: {}, query: {} },
      emit: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as GameSocket;

    const service = new SessionLifecycleService(
      config,
      {
        synchronizeFirebaseUser: async () => ({ id: 'user-a', firebaseUid: 'firebase-a' }),
        findCharacterForCurrentRealm: async () => databaseCharacter,
      } as unknown as CharacterService,
      {
        getCurrentRealm: async () => ({
          id: 'realm-a',
          slug: 'world-1',
          name: 'World 1',
          defaultMapId: 'map-a',
        }),
      } as unknown as RealmService,
      {
        getMap: async () => map,
        findNearestWalkable: (_map: unknown, requested: { x: number; y: number }) => requested,
      } as unknown as MapService,
      movement,
      {
        toMapState: () => ({
          id: map.id,
          key: map.key,
          name: map.name,
          width: map.width,
          height: map.height,
          zoneType: map.zoneType,
          version: map.version,
        }),
      } as unknown as MovementService,
      persistence,
      world,
      {
        addSession: () => [],
        removeSession: vi.fn(),
      } as unknown as VisibilityService,
      publisher,
      {
        resolveLocale: () => 'en',
        translate: (key: string) => key,
      } as unknown as LocalizationService,
      new SessionClaimExecutor(),
    );

    await service.initializeConnection(client);

    const replacement = world.getBySocketId('socket-new');
    expect(replacement).toBeDefined();
    expect({ x: replacement?.x, y: replacement?.y, revision: replacement?.stateRevision }).toEqual({
      x: 8,
      y: 9,
      revision: 11,
    });
    expect(persistence.queueDetachedSnapshot).toHaveBeenCalledOnce();
    expect(publisher.disconnect).toHaveBeenCalledWith('socket-old');
  });

  it('serializes concurrent session takeovers through durable reload and registration', async () => {
    const config = {
      values: {
        MOVE_STEP_MS: 200,
        SPATIAL_BUCKET_SIZE: 8,
        FOV_HALF_WIDTH: 12,
        FOV_HALF_HEIGHT: 8,
        MAX_FOV_HALF_WIDTH: 24,
        MAX_FOV_HALF_HEIGHT: 18,
      },
    } as unknown as GameConfigService;
    const spatial = new SpatialIndexService(config);
    const world = new RealWorldStateService(config, spatial);
    let databaseCharacter = characterState();
    const existing = world.createSession({
      socketId: 'socket-old',
      connectionId: 'connection-old',
      locale: 'en',
      character: databaseCharacter,
      mapId: 'map-a',
      x: 8,
      y: 9,
    });
    existing.stateRevision = 11;
    existing.dirty = true;
    world.addSession(existing);

    let releaseFirstSave!: () => void;
    const firstSaveGate = new Promise<void>((resolve) => {
      releaseFirstSave = resolve;
    });
    let signalFirstSave!: () => void;
    const firstSaveStarted = new Promise<void>((resolve) => {
      signalFirstSave = resolve;
    });
    let detachedSaveCount = 0;
    const persistence = {
      flushDetachedCharacter: vi.fn(async () => undefined),
      capture: capturePlayerState,
      queueDetachedSnapshot: vi.fn(async (snapshot: ReturnType<typeof capturePlayerState>) => {
        detachedSaveCount += 1;
        if (detachedSaveCount === 1) {
          signalFirstSave();
          await firstSaveGate;
        }
        databaseCharacter = characterState({
          mapId: snapshot.mapId,
          x: snapshot.x,
          y: snapshot.y,
          direction: snapshot.direction,
          stateVersion: snapshot.revision,
        });
      }),
      persistSnapshot: vi.fn(async (snapshot: ReturnType<typeof capturePlayerState>) => snapshot),
    } as unknown as PlayerPersistenceService;
    const movement = {
      quiesce: vi.fn(async (_session: unknown, task: () => unknown) => task()),
    } as unknown as MovementCoordinatorService;
    const map = createRuntimeMap({ id: 'map-a', key: 'map-a', width: 16, height: 16 });
    const publisher = {
      emit: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as WorldEventsPublisher;
    const service = new SessionLifecycleService(
      config,
      {
        synchronizeFirebaseUser: async () => ({ id: 'user-a', firebaseUid: 'firebase-a' }),
        findCharacterForCurrentRealm: async () => databaseCharacter,
      } as unknown as CharacterService,
      {
        getCurrentRealm: async () => ({
          id: 'realm-a',
          slug: 'world-1',
          name: 'World 1',
          defaultMapId: 'map-a',
        }),
      } as unknown as RealmService,
      {
        getMap: async () => map,
        findNearestWalkable: (_map: unknown, requested: { x: number; y: number }) => requested,
      } as unknown as MapService,
      movement,
      {
        toMapState: () => ({
          id: map.id,
          key: map.key,
          name: map.name,
          width: map.width,
          height: map.height,
          zoneType: map.zoneType,
          version: map.version,
        }),
      } as unknown as MovementService,
      persistence,
      world,
      {
        addSession: () => [],
        removeSession: vi.fn(),
      } as unknown as VisibilityService,
      publisher,
      {
        resolveLocale: () => 'en',
        translate: (key: string) => key,
      } as unknown as LocalizationService,
      new SessionClaimExecutor(),
    );
    const createClient = (id: string) =>
      ({
        id,
        connected: true,
        data: {
          auth: {
            firebaseUid: 'firebase-a',
            tokenIssuedAt: 1,
          } satisfies AuthContext,
        },
        handshake: { auth: {}, query: {} },
        emit: vi.fn(),
        disconnect: vi.fn(),
      }) as unknown as GameSocket;
    const firstClient = createClient('socket-first');
    const newestClient = createClient('socket-newest');

    const firstInitialization = service.initializeConnection(firstClient);
    await firstSaveStarted;
    const newestInitialization = service.initializeConnection(newestClient);
    await Promise.resolve();
    await Promise.resolve();

    expect(world.getBySocketId('socket-newest')).toBeUndefined();

    releaseFirstSave();
    await Promise.all([firstInitialization, newestInitialization]);

    const finalSession = world.getByCharacterId('character-a');
    expect(finalSession?.socketId).toBe('socket-newest');
    expect({
      x: finalSession?.x,
      y: finalSession?.y,
      revision: finalSession?.stateRevision,
    }).toEqual({ x: 8, y: 9, revision: 11 });
    expect(persistence.queueDetachedSnapshot).toHaveBeenCalledTimes(2);
    expect(publisher.disconnect).toHaveBeenCalledWith('socket-first');
  });

});
