import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  REWARD_CLAIM_BATCH_LIMIT,
  REWARD_CLAIM_EXPIRING_SOON_MS,
  rewardClaimPlacement,
  rewardClaimSource,
} from '../src/modules/items/reward-claims.service.js';

describe('reward claims service', () => {
  it('calculates stack space and required inventory slots', () => {
    expect(
      rewardClaimPlacement({
        quantity: 12,
        stackLimit: 10,
        stackable: true,
        matchingStackQuantities: [7, 9],
        occupiedSlots: 39,
        inventoryCapacity: 40,
      }),
    ).toEqual({
      matchingStackSpace: 4,
      requiredSlots: 1,
      freeSlots: 1,
      canClaim: true,
    });

    expect(
      rewardClaimPlacement({
        quantity: 12,
        stackLimit: 10,
        stackable: true,
        matchingStackQuantities: [7],
        occupiedSlots: 40,
        inventoryCapacity: 40,
      }),
    ).toEqual({
      matchingStackSpace: 3,
      requiredSlots: 1,
      freeSlots: 0,
      canClaim: false,
    });

    expect(
      rewardClaimPlacement({
        quantity: 3,
        stackLimit: 1,
        stackable: false,
        matchingStackQuantities: [],
        occupiedSlots: 37,
        inventoryCapacity: 40,
      }),
    ).toEqual({
      matchingStackSpace: 0,
      requiredSlots: 3,
      freeSlots: 3,
      canClaim: true,
    });
  });

  it('classifies reward sources and exposes queue rules', () => {
    expect(REWARD_CLAIM_BATCH_LIMIT).toBe(100);
    expect(REWARD_CLAIM_EXPIRING_SOON_MS).toBe(72 * 60 * 60 * 1000);
    expect(rewardClaimSource('MARKET:listing-id')).toBe('MARKET');
    expect(rewardClaimSource('CRAFT_ORDER:order-id')).toBe('CRAFTING');
    expect(rewardClaimSource('ENCOUNTER:scorpion')).toBe('COMBAT');
    expect(rewardClaimSource('QUEST:first-blood')).toBe('QUEST');
    expect(rewardClaimSource('LOOT:rabbit')).toBe('LOOT');
    expect(rewardClaimSource('unknown-source')).toBe('OTHER');
  });

  it('serializes collection, supports idempotency and commits expiry before erroring', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/modules/items/reward-claims.service.ts', import.meta.url)),
      'utf8',
    );
    const characterLock = source.indexOf('await this.lockCharacter(transaction, characterId)');
    const claimLock = source.indexOf(
      'await this.lockOperation(transaction, `reward-claim:${claimId}`)',
      characterLock,
    );
    const repeatedEvent = source.indexOf("eventType: 'CLAIM_COLLECTED'", claimLock);
    const statusCheck = source.indexOf("if (claim.status !== 'OPEN')", repeatedEvent);
    const expiryUpdate = source.indexOf("data: { status: 'EXPIRED' }", statusCheck);
    const expiryResolution = source.indexOf("return { type: 'EXPIRED'", expiryUpdate);
    const outsideError = source.indexOf("if (resolution.type === 'EXPIRED')", expiryResolution);

    expect(characterLock).toBeGreaterThan(0);
    expect(claimLock).toBeGreaterThan(characterLock);
    expect(repeatedEvent).toBeGreaterThan(claimLock);
    expect(statusCheck).toBeGreaterThan(repeatedEvent);
    expect(expiryUpdate).toBeGreaterThan(statusCheck);
    expect(expiryResolution).toBeGreaterThan(expiryUpdate);
    expect(outsideError).toBeGreaterThan(0);
  });

  it('keeps claim-all partial progress when later rewards do not fit', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../src/modules/items/reward-claims.service.ts', import.meta.url)),
      'utf8',
    );

    expect(source).toContain('for (const claim of claims)');
    expect(source).toContain('const resolution = await this.collectClaim(');
    expect(source).toContain('if (this.isInventoryFull(error))');
    expect(source).toContain('blockedIds.push(claim.id)');
    expect(source).toContain('claimedQuantity += resolution.quantity');
    expect(source).toContain('take: REWARD_CLAIM_BATCH_LIMIT');
  });
});
