import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('combat animation styles', () => {
  it('keeps attack shake off the arena root so its entrance animation cannot restart', async () => {
    const [styles, arena] = await Promise.all([
      readFile(resolve(process.cwd(), 'src/combat.css'), 'utf8'),
      readFile(resolve(process.cwd(), 'src/ui/combat/CombatArena.tsx'), 'utf8'),
    ]);

    const rootRule = styles.match(/\.combat-arena-root\s*\{(?<body>[^}]*)\}/)?.groups?.body;
    const vfxRule = styles.match(/\.combat-vfx\s*\{(?<body>[^}]*)\}/)?.groups?.body;

    expect(rootRule).toContain('animation: combat-arena-enter');
    expect(vfxRule).toContain('animation: combat-vfx-shake');
    expect(styles).not.toContain('.combat-arena-action');
    expect(arena).not.toContain('combat-arena-action');
  });
});
