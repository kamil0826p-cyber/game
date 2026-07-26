import { describe, expect, it } from 'vitest';
import type { PersistedCharacterState } from '../src/common/domain/game.types.js';
import type { GameConfigService } from '../src/config/game-config.service.js';
import { SpatialIndexService } from '../src/modules/world/spatial-index.service.js';
import { WorldStateService } from '../src/modules/world/world-state.service.js';

const config = {
  values: {
    SPATIAL_BUCKET_SIZE: 8,
    FOV_HALF_WIDTH: 12,
    FOV_HALF_HEIGHT: 8,
    MAX_FOV_HALF_WIDTH: 24,
    MAX_FOV_HALF_HEIGHT: 18,
  },
} as unknown as GameConfigService;

const character: PersistedCharacterState = {
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
  stateVersion: 7,
  lastSavedAt: new Date(0),
};

describe('WorldStateService', () => {
  it('assigns a new revision when an invalid persisted position is repaired at spawn', () => {
    const spatial = new SpatialIndexService(config);
    const world = new WorldStateService(config, spatial);

    const session = world.createSession({
      socketId: 'socket-a',
      connectionId: 'connection-a',
      locale: 'en',
      character,
      mapId: 'map-b',
      x: 4,
      y: 5,
    });

    expect(session.stateRevision).toBe(8);
    expect(session.persistedRevision).toBe(7);
    expect(session.dirty).toBe(true);
  });

  it('keeps the persisted revision when the saved spawn is already valid', () => {
    const spatial = new SpatialIndexService(config);
    const world = new WorldStateService(config, spatial);

    const session = world.createSession({
      socketId: 'socket-a',
      connectionId: 'connection-a',
      locale: 'en',
      character,
      mapId: character.mapId,
      x: character.x,
      y: character.y,
    });

    expect(session.stateRevision).toBe(7);
    expect(session.persistedRevision).toBe(7);
    expect(session.dirty).toBe(false);
  });
});
