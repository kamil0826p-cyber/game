import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('combat target marker positioning', () => {
  it('keeps the marker above players and compensates for scaled mob previews', async () => {
    const styles = await readFile(
      resolve(process.cwd(), 'src/combat-target-marker.css'),
      'utf8',
    );

    expect(styles).toContain('.combat-stage-unit-selected .combat-stage-actor::after');
    expect(styles).toContain('top: -1.15rem');
    expect(styles).toContain("aria-label^='mob-spawn-rabbit '");
    expect(styles).toContain('top: clamp(1.4rem, 20%, 2.15rem)');
    expect(styles).toContain("aria-label^='mob-executioner-scorpion '");
    expect(styles).toContain('top: -0.45rem');
  });
});
