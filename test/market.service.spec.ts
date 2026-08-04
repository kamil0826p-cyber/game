import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MARKET_ACTIVE_LISTING_LIMIT,
  MARKET_COMMISSION_RATE,
  MARKET_LISTING_FEE_RATE,
  MARKET_LISTING_TTL_MS,
  marketCommission,
  marketListingFee,
  marketUnitPrice,
} from '../src/modules/items/market.service.js';

describe('player item market', () => {
  it('uses the configured listing fee, sale commission and unit price rules', () => {
    expect(MARKET_ACTIVE_LISTING_LIMIT).toBe(20);
    expect(MARKET_LISTING_TTL_MS).toBe(3 * 24 * 60 * 60 * 1000);
    expect(MARKET_LISTING_FEE_RATE).toBe(0.02);
    expect(MARKET_COMMISSION_RATE).toBe(0.05);
    expect(marketListingFee(1)).toBe(1);
    expect(marketListingFee(100)).toBe(2);
    expect(marketListingFee(149)).toBe(2);
    expect(marketCommission(1)).toBe(0);
    expect(marketCommission(2)).toBe(1);
    expect(marketCommission(100)).toBe(5);
    expect(marketCommission(199)).toBe(9);
    expect(1 - marketCommission(1)).toBe(1);
    expect(2 - marketCommission(2)).toBe(1);
    expect(marketUnitPrice(300, 3)).toBe(100);
    expect(marketUnitPrice(301, 3)).toBe(100);
  });

  it('keeps listings inside one realm and serializes buyer, seller and listing mutations', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/modules/items/market.service.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toContain('sellerCharacterId: { in: realmCharacterIds }');
    expect(source).toContain("reason: 'MARKET_REALM_MISMATCH'");
    expect(source).toContain('await this.lockOperation(transaction, `market:${listingId}`)');
    expect(source).toContain(
      'await this.lockCharacters(transaction, [buyerCharacterId, listing.sellerCharacterId])',
    );
    expect(source).toContain("status !== 'ACTIVE'");
    expect(source).toContain("reason: 'MARKET_SELF_TRADE'");
  });

  it('commits an expired listing return before reporting the failed purchase', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/modules/items/market.service.ts', import.meta.url)),
      'utf8',
    );
    const returnIndex = source.indexOf(
      "await this.returnListing(transaction, listing as ListingRecord, 'EXPIRED')",
    );
    const resolutionIndex = source.indexOf("return { type: 'EXPIRED', listingId }", returnIndex);
    const errorIndex = source.indexOf("if (resolution.type === 'EXPIRED')", resolutionIndex);

    expect(returnIndex).toBeGreaterThan(0);
    expect(resolutionIndex).toBeGreaterThan(returnIndex);
    expect(errorIndex).toBeGreaterThan(resolutionIndex);
  });

  it('rejects quest, bound and non-tradeable items and records delivery overflow', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/modules/items/market.service.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toContain("metadata.category === 'QUEST'");
    expect(source).toContain("snapshot.tradePolicy !== 'TRADEABLE'");
    expect(source).toContain('snapshot.boundCharacterId');
    expect(source).toContain("grant.claimedQuantity > 0 ? 'CLAIMS' : 'INVENTORY'");
    expect(source).toContain("eventType: 'MARKET_PURCHASED'");
    expect(source).toContain("eventType: 'MARKET_SOLD'");
    expect(source).toContain('itemMarketPriceSample.create');
  });
});
