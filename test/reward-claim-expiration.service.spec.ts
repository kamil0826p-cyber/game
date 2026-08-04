import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { REWARD_CLAIM_EXPIRATION_SWEEP_INTERVAL_MS } from '../src/modules/items/reward-claim-expiration.service.js';

describe('reward claim expiration worker', () => {
  it('runs immediately, repeats every minute and prevents overlapping sweeps', () => {
    const source = readFileSync(
      fileURLToPath(
        new URL('../src/modules/items/reward-claim-expiration.service.ts', import.meta.url),
      ),
      'utf8',
    );

    expect(REWARD_CLAIM_EXPIRATION_SWEEP_INTERVAL_MS).toBe(60_000);
    expect(source).toContain('void this.sweep()');
    expect(source).toContain('if (this.sweepRunning) return');
    expect(source).toContain('this.sweepRunning = true');
    expect(source).toContain('this.sweepRunning = false');
    expect(source).toContain('this.timer.unref()');
  });

  it('drains all batches and notifies affected online characters once', () => {
    const source = readFileSync(
      fileURLToPath(
        new URL('../src/modules/items/reward-claim-expiration.service.ts', import.meta.url),
      ),
      'utf8',
    );

    expect(source).toContain('const affected = new Set<string>()');
    expect(source).toContain('const result = await this.claims.expireOpenClaims(100)');
    expect(source).toContain('} while (expiredCount > 0)');
    expect(source).toContain("code: 'REWARD_CLAIM_EXPIRED'");
  });
});
