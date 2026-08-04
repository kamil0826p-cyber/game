import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

describe('craft order gateway boundaries', () => {
  it('exposes order commands only through the proximity-checked crafting gateway', () => {
    const craftingGateway = read('../src/modules/items/crafting.gateway.ts');
    const economyGateway = read('../src/modules/items/item-economy.gateway.ts');

    expect(craftingGateway).toContain("@SubscribeMessage('crafting:orderCreate')");
    expect(craftingGateway).toContain("@SubscribeMessage('crafting:orderFulfill')");
    expect(craftingGateway).toContain("@SubscribeMessage('crafting:orderCancel')");
    expect(craftingGateway).toContain('await this.requireStation(client, session)');
    expect(craftingGateway).toContain('rewardSilver: z.number().int().min(0)');

    expect(economyGateway).not.toContain("@SubscribeMessage('itemization:craft')");
    expect(economyGateway).not.toContain("@SubscribeMessage('itemization:craftOrder:create')");
    expect(economyGateway).not.toContain("@SubscribeMessage('itemization:craftOrder:fulfill')");
    expect(economyGateway).not.toContain("@SubscribeMessage('itemization:craftOrder:cancel')");
  });
});
