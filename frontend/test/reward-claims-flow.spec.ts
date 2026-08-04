import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('reward claims player flow', () => {
  it('connects get, single claim and claim-all events and refreshes inventory', () => {
    const source = read('../src/game/realtime/rewardClaimsSocketBridge.ts');

    expect(source).toContain("'claims:get'");
    expect(source).toContain("'claims:claim'");
    expect(source).toContain("'claims:claimAll'");
    expect(source).toContain('client.getInventory()');
    expect(source).toContain('publishRewardClaimsUpdated');
  });

  it('shows the reward queue in the HUD with a live expiring badge', () => {
    const buttons = read('../src/ui/hud/HudButtons.tsx');
    const hud = read('../src/ui/hud/GameHud.tsx');
    const overlay = read('../src/ui/rewards/RewardClaimsOverlay.tsx');

    expect(buttons).toContain("key: 'rewards'");
    expect(buttons).toContain("hotkey: 'R'");
    expect(buttons).toContain('REWARD_CLAIMS_UPDATED_EVENT');
    expect(buttons).toContain('expiringSoonCount > 0');
    expect(hud).toContain('<RewardClaimsOverlay />');
    expect(overlay).toContain("event.key === 'r' || event.key === 'R'");
  });

  it('renders capacity, expiry, filters and complete item details', () => {
    const modal = read('../src/ui/rewards/RewardClaimsModal.tsx');

    expect(modal).toContain("'EXPIRING'");
    expect(modal).toContain('claim.expiringSoon');
    expect(modal).toContain('claim.capacity.requiredSlots');
    expect(modal).toContain('claim.capacity.matchingStackSpace');
    expect(modal).toContain('connection.claimAllRewards()');
    expect(modal).toContain('connection.claimReward(claimId)');
    expect(modal).toContain('item.affixes');
    expect(modal).toContain('item.relic');
    expect(modal).toContain('item.curse');
  });

  it('invalidates the reward badge after market overflow delivery', () => {
    const marketBridge = read('../src/game/realtime/marketSocketBridge.ts');

    expect(marketBridge).toContain("result.mutation.delivery === 'CLAIMS'");
    expect(marketBridge).toContain('invalidateRewardClaims()');
  });
});
