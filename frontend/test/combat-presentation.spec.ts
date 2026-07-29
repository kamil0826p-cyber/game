import { describe, expect, it } from 'vitest';
import { actionDamageFor, getCombatVfxFamily } from '../src/game/combat/combatPresentation';
import type { CombatActionResolutionPayload } from '../src/contracts/socket';

describe('combat presentation', () => {
  it('routes stable animation keys to distinct VFX families', () => {
    expect(getCombatVfxFamily('mage-flame-orb')).toBe('fire');
    expect(getCombatVfxFamily('mage-frost-nova')).toBe('frost');
    expect(getCombatVfxFamily('mage-arcane-spark')).toBe('arcane');
    expect(getCombatVfxFamily('archer-quick-shot')).toBe('projectile');
    expect(getCombatVfxFamily('warrior-whirlwind')).toBe('physical');
  });

  it('sums only damage aimed at the requested actor', () => {
    const action = {
      results: [
        { targetActorId: 'target', hpDelta: -12 },
        { targetActorId: 'target', hpDelta: -4 },
        { targetActorId: 'other', hpDelta: -99 },
      ],
    } as CombatActionResolutionPayload;
    expect(actionDamageFor(action, 'target')).toBe(-16);
  });
});
