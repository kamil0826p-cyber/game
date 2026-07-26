import { describe, expect, it } from 'vitest';
import type { PersistedCharacterState } from '../src/common/domain/game.types.js';
import type { GameConfigService } from '../src/config/game-config.service.js';
import { SpatialIndexService } from '../src/modules/world/spatial-index.service.js';
import { VisibilityService } from '../src/modules/world/visibility.service.js';
import type { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import { WorldStateService } from '../src/modules/world/world-state.service.js';

const config = {
  values: {
    SPATIAL_BUCKET_SIZE: 4,
    FOV_HALF_WIDTH: 2,
    FOV_HALF_HEIGHT: 2,
    MAX_FOV_HALF_WIDTH: 4,
    MAX_FOV_HALF_HEIGHT: 4,
  },
} as unknown as GameConfigService;

const character = (
  id: string,
  x: number,
  y: number,
): PersistedCharacterState => ({
  id,
  userId: `user-${id}`,
  realmId: 'realm-a',
  name: id,
  characterClass: 'WARRIOR',
  level: 1,
  experience: 0,
  outfitKey: 'warrior-recruit',
  mapId: 'map-a',
  x,
  y,
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
  stateVersion: 0,
  lastSavedAt: new Date(0),
});

describe('VisibilityService', () => {
  it('emits enter and leave only for exact FOV relationships', () => {
    const spatial = new SpatialIndexService(config);
    const world = new WorldStateService(config, spatial);
    const events: Array<{ socketId: string; event: string; payload: unknown }> = [];
    const publisher = {
      emit: (socketId: string, event: string, payload: unknown) => {
        events.push({ socketId, event, payload });
      },
    } as unknown as WorldEventsPublisher;
    const visibility = new VisibilityService(config, world, publisher);

    const viewer = world.createSession({
      socketId: 'socket-viewer',
      connectionId: 'connection-viewer',
      locale: 'en',
      character: character('viewer', 5, 5),
      mapId: 'map-a',
      x: 5,
      y: 5,
    });
    const subject = world.createSession({
      socketId: 'socket-subject',
      connectionId: 'connection-subject',
      locale: 'en',
      character: character('subject', 6, 5),
      mapId: 'map-a',
      x: 6,
      y: 5,
    });

    world.addSession(viewer);
    expect(visibility.addSession(viewer)).toEqual([]);
    world.addSession(subject);
    expect(visibility.addSession(subject).map((player) => player.characterId)).toEqual([
      'viewer',
    ]);
    expect(viewer.visibleCharacterIds.has('subject')).toBe(true);
    expect(subject.watcherCharacterIds.has('viewer')).toBe(true);
    expect(events.some((event) => event.socketId === 'socket-viewer' && event.event === 'world:playerEntered')).toBe(true);

    events.length = 0;
    const previous = world.updatePosition(subject, {
      mapId: 'map-a',
      x: 10,
      y: 5,
      direction: 'EAST',
    });
    visibility.afterMovement(subject, previous, false);

    expect(viewer.visibleCharacterIds.has('subject')).toBe(false);
    expect(events.some((event) => event.socketId === 'socket-viewer' && event.event === 'world:playerLeft')).toBe(true);
  });
});
