import { describe, expect, it } from 'vitest';
import { KeyedSerialExecutor } from '../src/common/utils/keyed-serial-executor.js';

describe('KeyedSerialExecutor', () => {
  it('serializes work for the same key and allows different keys to progress', async () => {
    const executor = new KeyedSerialExecutor();
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = executor.run('character-a', async () => {
      order.push('a1-start');
      await firstGate;
      order.push('a1-end');
    });
    const second = executor.run('character-a', async () => {
      order.push('a2');
    });
    const independent = executor.run('character-b', async () => {
      order.push('b1');
    });

    await independent;
    expect(order).toEqual(['a1-start', 'b1']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(['a1-start', 'b1', 'a1-end', 'a2']);
  });
});
