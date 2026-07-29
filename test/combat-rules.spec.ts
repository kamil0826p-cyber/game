import { describe, expect, it } from 'vitest';
import { getPvpEngagementPolicy } from '../src/common/rules/player-interaction-request.js';
import {
  combatActorLockKeys,
  isCombatDistanceAllowed,
  physicalDamageMultiplier,
} from '../src/modules/combat/combat.rules.js';

describe('combat rules', () => {
  it('maps map zones to the required PVP consent policy', () => {
    expect(getPvpEngagementPolicy('SAFE')).toBe('FORBIDDEN');
    expect(getPvpEngagementPolicy('OUTLAW')).toBe('CONSENT');
    expect(getPvpEngagementPolicy('PVP')).toBe('IMMEDIATE');
  });

  it('uses the shared adjacent-actor range rule', () => {
    expect(
      isCombatDistanceAllowed({ mapId: 'map-a', x: 5, y: 5 }, { mapId: 'map-a', x: 6, y: 6 }),
    ).toBe(true);
    expect(
      isCombatDistanceAllowed({ mapId: 'map-a', x: 5, y: 5 }, { mapId: 'map-a', x: 7, y: 5 }),
    ).toBe(false);
  });

  it('orders actor locks deterministically and caps armor penetration', () => {
    expect(combatActorLockKeys('b', 'a')).toEqual(['combat-actor:a', 'combat-actor:b']);
    expect(physicalDamageMultiplier(100, 0.5)).toBeCloseTo(2 / 3);
    expect(physicalDamageMultiplier(100, 99)).toBeCloseTo(10 / 11);
  });
});
