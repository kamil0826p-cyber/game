import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('market socket contract', () => {
  it('exposes the market only through the NPC-bound gateway', () => {
    const marketGateway = readFileSync(
      fileURLToPath(new URL('../src/modules/items/market.gateway.ts', import.meta.url)),
      'utf8',
    );
    const legacyGateway = readFileSync(
      fileURLToPath(new URL('../src/modules/items/item-economy.gateway.ts', import.meta.url)),
      'utf8',
    );

    for (const event of ['market:get', 'market:list', 'market:buy', 'market:cancel', 'market:close']) {
      expect(marketGateway).toContain(`@SubscribeMessage('${event}')`);
    }
    expect(marketGateway).toContain('await this.requireStation(client, session)');
    expect(marketGateway).toContain('await this.npcs.assertInteractionAvailable');
    expect(marketGateway).toContain('this.syncSellerAfterSale(result)');

    expect(legacyGateway).not.toContain('itemization:market:get');
    expect(legacyGateway).not.toContain('itemization:market:list');
    expect(legacyGateway).not.toContain('itemization:market:buy');
    expect(legacyGateway).not.toContain('itemization:market:cancel');
  });
});
