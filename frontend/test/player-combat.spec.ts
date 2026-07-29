import { describe, expect, it } from 'vitest';
import { getPlayerCombatAvailability } from '../src/game/combat/playerCombat';

const self = { characterId: 'self', mapId: 'map-a', x: 10, y: 10 };
const other = { characterId: 'other', mapId: 'map-a', x: 11, y: 11 };

describe('player combat interaction', () => {
  it('requires consent in Outlaw and starts immediately in PVP', () => {
    expect(getPlayerCombatAvailability(self, other, 'OUTLAW')).toBe('AVAILABLE_WITH_CONSENT');
    expect(getPlayerCombatAvailability(self, other, 'PVP')).toBe('AVAILABLE_IMMEDIATELY');
  });

  it('reports safe zones, self targeting, and distance before sending an intent', () => {
    expect(getPlayerCombatAvailability(self, other, 'SAFE')).toBe('SAFE_ZONE');
    expect(getPlayerCombatAvailability(self, self, 'PVP')).toBe('SELF');
    expect(getPlayerCombatAvailability(self, { ...other, x: 12, y: 10 }, 'PVP')).toBe(
      'TOO_FAR',
    );
  });
});
