import type { Direction } from '../../contracts/game';
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

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
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

  constructor(private readonly client: GameSocketClient) {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  update(now: number): void {
    const state = gameStore.getSnapshot();
    if (
      state.phase !== 'in-world' ||
      !state.socketConnected ||
      state.portalTransition !== 'idle' ||
      this.requestInFlight ||
      now < this.nextAllowedAt
    ) {
      return;
    }
    const direction = this.activeDirection();
    if (!direction) {
      return;
    }

    this.requestInFlight = true;
    this.nextAllowedAt = now + state.movementStepMs;
    gameStore.clearPlannedPath();
    void this.client.requestStep(direction).finally(() => {
      this.requestInFlight = false;
    });
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (isEditableTarget(event.target)) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      void this.client.stopMovement();
      return;
    }
    const direction = directionByKey[event.key];
    if (!direction) {
      return;
    }
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
      if (direction && (!latest || time > latest.time)) {
        latest = { direction, time };
      }
    }
    return latest?.direction;
  }
}
