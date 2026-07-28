import type { Direction } from '../../contracts/game';
import type { LoadedMapDefinition } from '../../contracts/tiled';
import { mapRepository } from '../map/MapRepository';
import { isCollisionTile } from '../map/tiledMap';
import { GameSocketClient } from '../realtime/GameSocketClient';
import { gameStore } from '../state/gameStore';

const directionByKey: Readonly<Record<string, Direction | undefined>> = {
  w: 'NORTH',
  W: 'NORTH',
  ArrowUp: 'NORTH',
  d: 'EAST',
  D: 'EAST',
  ArrowRight: 'EAST',
  s: 'SOUTH',
  S: 'SOUTH',
  ArrowDown: 'SOUTH',
  a: 'WEST',
  A: 'WEST',
  ArrowLeft: 'WEST',
};

const directionDelta: Readonly<Record<Direction, { x: number; y: number }>> = {
  NORTH: { x: 0, y: -1 },
  EAST: { x: 1, y: 0 },
  SOUTH: { x: 0, y: 1 },
  WEST: { x: -1, y: 0 },
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
};

export class KeyboardMovementController {
  private readonly pressed = new Map<string, number>();
  private nextAllowedAt = 0;
  private requestInFlight = false;
  private currentMap: LoadedMapDefinition | undefined;
  private currentMapIdentity = '';
  private mapLoadSequence = 0;

  constructor(private readonly client: GameSocketClient) {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  update(now: number): void {
    const state = gameStore.getSnapshot();
    if (state.map) this.ensureMap(state.map.key, state.map.version);
    if (
      state.phase !== 'in-world' ||
      !state.socketConnected ||
      state.portalTransition !== 'idle' ||
      state.activeModal ||
      this.requestInFlight ||
      now < this.nextAllowedAt
    )
      return;

    const direction = this.activeDirection();
    const self = state.self;
    const map = this.currentMap;
    if (!direction || !self || !map || state.map?.key !== map.key) return;

    const delta = directionDelta[direction];
    const targetX = self.x + delta.x;
    const targetY = self.y + delta.y;
    const occupiedByNpc = state.npcs.some((npc) => npc.x === targetX && npc.y === targetY);
    const occupiedByPlayer =
      state.map.zoneType !== 'SAFE' &&
      Object.values(state.players).some(
        (player) =>
          player.characterId !== self.characterId &&
          player.mapId === self.mapId &&
          player.x === targetX &&
          player.y === targetY,
      );

    gameStore.clearPlannedPath();
    this.nextAllowedAt = now + state.movementStepMs;
    if (isCollisionTile(map, targetX, targetY) || occupiedByNpc || occupiedByPlayer) return;

    this.requestInFlight = true;
    void this.client.requestStep(direction).finally(() => {
      this.requestInFlight = false;
    });
  }

  destroy(): void {
    this.mapLoadSequence += 1;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private ensureMap(key: string, version: number): void {
    const identity = `${key}:${version}`;
    if (identity === this.currentMapIdentity) return;
    this.currentMapIdentity = identity;
    this.currentMap = undefined;
    const sequence = ++this.mapLoadSequence;
    void mapRepository
      .load(key, version)
      .then((map) => {
        if (sequence === this.mapLoadSequence && this.currentMapIdentity === identity)
          this.currentMap = map;
      })
      .catch(() => {
        if (sequence === this.mapLoadSequence) this.currentMapIdentity = '';
      });
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      this.pressed.clear();
      void this.client.stopMovement();
      return;
    }
    const direction = directionByKey[event.key];
    if (!direction) return;
    event.preventDefault();
    if (!this.pressed.has(event.key)) {
      this.pressed.set(event.key, performance.now());
      this.nextAllowedAt = 0;
    }
  };

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    this.pressed.delete(event.key);
  };

  private readonly onBlur = (): void => {
    this.pressed.clear();
  };

  private activeDirection(): Direction | undefined {
    let latest: { direction: Direction; time: number } | undefined;
    for (const [key, time] of this.pressed) {
      const direction = directionByKey[key];
      if (direction && (!latest || time > latest.time)) latest = { direction, time };
    }
    return latest?.direction;
  }
}
