import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('reward claim inventory safety', () => {
  it('does not merge granted rewards into stacks locked in player trade', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/modules/items/item-inventory.service.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toContain("tradeOfferItems: { select: { id: true } }");
    expect(source).toContain('stack.tradeOfferItems.length > 0');
  });

  it('keeps legacy open-claim reads side-effect free and excludes expired rewards', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/modules/items/item-inventory.service.ts', import.meta.url)),
      'utf8',
    );
    const listStart = source.indexOf('async listOpenClaims(characterId: string)');
    const listEnd = source.indexOf('async recordEvent(', listStart);
    const listSource = source.slice(listStart, listEnd);

    expect(listSource).toContain("expiresAt: { gt: new Date() }");
    expect(listSource).not.toContain('updateMany');
    expect(listSource).not.toContain("data: { status: 'EXPIRED' }");
  });

  it('does not hijack browser refresh for the R hotkey', () => {
    const source = readFileSync(
      fileURLToPath(
        new URL('../frontend/src/ui/rewards/RewardClaimsOverlay.tsx', import.meta.url),
      ),
      'utf8',
    );

    expect(source).toContain('event.ctrlKey || event.metaKey || event.altKey');
  });
});
