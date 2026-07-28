import { describe, expect, it, vi } from 'vitest';
import { KeyedSerialExecutor } from '../src/common/utils/keyed-serial-executor.js';
import { MovementCoordinatorService } from '../src/modules/movement/movement-coordinator.service.js';
import type { MovementService } from '../src/modules/movement/movement.service.js';
import type { PathMovementService } from '../src/modules/movement/path-movement.service.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';

const session = {
  characterId: 'character-a',
} as PlayerSession;

describe('MovementCoordinatorService', () => {
  it('quiesces behind an in-flight movement before lifecycle cleanup', async () => {
    const order: string[] = [];
    let releaseStep!: () => void;
    const stepGate = new Promise<void>((resolve) => {
      releaseStep = resolve;
    });
    let signalStepStarted!: () => void;
    const stepStarted = new Promise<void>((resolve) => {
      signalStepStarted = resolve;
    });

    const movement = {
      performStep: vi.fn(async () => {
        order.push('step-start');
        signalStepStarted();
        await stepGate;
        order.push('step-end');
        return {
          accepted: true as const,
          payload: {
            requestId: 'request-1',
            source: 'DIRECT' as const,
            mapId: 'map-a',
            x: 2,
            y: 1,
            direction: 'EAST' as const,
            serverTime: 1,
          },
        };
      }),
    } as unknown as MovementService;
    const pathMovement = {
      cancel: vi.fn(() => true),
    } as unknown as PathMovementService;
    const coordinator = new MovementCoordinatorService(
      movement,
      pathMovement,
      new KeyedSerialExecutor(),
    );

    const directStep = coordinator.requestDirectStep(session, 'EAST', 'request-1');
    await stepStarted;
    const cleanup = coordinator.quiesce(session, () => {
      order.push('cleanup');
      return 'snapshot';
    });

    expect(order).toEqual(['step-start']);
    releaseStep();

    await expect(directStep).resolves.toMatchObject({ ok: true });
    await expect(cleanup).resolves.toBe('snapshot');
    expect(order).toEqual(['step-start', 'step-end', 'cleanup']);
    expect(pathMovement.cancel).toHaveBeenCalledTimes(2);
  });
});
