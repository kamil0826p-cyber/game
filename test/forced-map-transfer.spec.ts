import { describe, expect, it, vi } from 'vitest';
import type { GameConfigService } from '../src/config/game-config.service.js';
import type { LocalizationService } from '../src/i18n/localization.service.js';
import type { MapService } from '../src/modules/maps/map.service.js';
import { MovementService } from '../src/modules/movement/movement.service.js';
import type { NpcService } from '../src/modules/npcs/npc.service.js';
import type { PlayerPersistenceService } from '../src/modules/persistence/player-persistence.service.js';
import { capturePlayerState } from '../src/modules/persistence/player-state-snapshot.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';
import type { VisibilityService } from '../src/modules/world/visibility.service.js';
import type { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import type { WorldStateService } from '../src/modules/world/world-state.service.js';
import { createRuntimeMap } from './helpers/runtime-map.js';

const createSession = (): PlayerSession => ({
  socketId: 'socket-a', connectionId: 'connection-a', characterId: 'character-a', userId: 'user-a',
  realmId: 'realm-a', name: 'Hero', characterClass: 'WARRIOR', gender: 'MALE', level: 1,
  experience: 0, silver: 0, gold: 0, outfitKey: 'warrior-recruit', mapId: 'map-a', x: 4, y: 4,
  direction: 'NORTH', combatState: 'IDLE', hp: 35, maxHp: 100, energy: 10, maxEnergy: 50,
  strength: 10, agility: 5, intelligence: 2, armor: 5, locale: 'en',
  viewport: { halfWidth: 10, halfHeight: 8 }, connectedAt: 0, nextMoveAllowedAt: 0,
  stateRevision: 2, persistedRevision: 2, dirty: true, activeInWorld: true,
  visibleCharacterIds: new Set<string>(), watcherCharacterIds: new Set<string>(),
});

describe('MovementService system transfer', () => {
  it('moves the player to a free recovery spawn and publishes a map change', async () => {
    const session = createSession();
    const destinationMap = createRuntimeMap({ id: 'hospital-id', key: 'ashen-infirmary' });
    const emitted: string[] = [];
    const persistSnapshot = vi.fn(async (snapshot: ReturnType<typeof capturePlayerState>) => snapshot);
    const worldState = {
      getByCharacterId: () => session,
      isOccupied: (_mapId: string, x: number, y: number) => x === 1 && y === 1,
      updatePosition: (
        target: PlayerSession,
        next: { mapId: string; x: number; y: number; direction: 'SOUTH' },
      ) => {
        const previous = { mapId: target.mapId, x: target.x, y: target.y, direction: target.direction };
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
        getMapByKey: async () => destinationMap,
        findNearestWalkable: (_map: unknown, _requested: unknown, blocked: (x: number, y: number) => boolean) =>
          blocked(1, 1) ? { x: 1, y: 0 } : { x: 1, y: 1 },
      } as unknown as MapService,
      { getMapNpcs: async () => [] } as unknown as NpcService,
      worldState,
      { afterMovement: () => [] } as unknown as VisibilityService,
      {
        emit: (_socketId: string, event: string) => emitted.push(event),
      } as unknown as WorldEventsPublisher,
      {} as LocalizationService,
      {
        capture: capturePlayerState,
        persistSnapshot,
      } as unknown as PlayerPersistenceService,
    );

    await service.transferToMap(session, 'ashen-infirmary');

    expect({ mapId: session.mapId, x: session.x, y: session.y, direction: session.direction }).toEqual({
      mapId: 'hospital-id', x: 1, y: 0, direction: 'SOUTH',
    });
    expect(emitted).toEqual(['world:mapChanged']);
    expect(persistSnapshot).toHaveBeenCalledWith(expect.any(Object), 'combat');
  });
});
