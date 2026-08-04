import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('reward claims gateway contract', () => {
  it('exposes the secure reward claims events', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/modules/items/reward-claims.gateway.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toContain("@SubscribeMessage('claims:get')");
    expect(source).toContain("@SubscribeMessage('claims:claim')");
    expect(source).toContain("@SubscribeMessage('claims:claimAll')");
    expect(source).toContain('this.movementCoordinator.runSerialized');
    expect(source).toContain("client.data.sessionState !== 'IN_WORLD'");
    expect(source).toContain("session.combatState !== 'IDLE'");
    expect(source).toContain('claimId: z.string().uuid()');
  });

  it('removes the legacy itemization claims events', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/modules/items/item-economy.gateway.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toContain("itemization:claims:get");
    expect(source).not.toContain("itemization:claims:claim");
  });
});
