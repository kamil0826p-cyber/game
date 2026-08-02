import { describe, expect, it } from 'vitest';
import type { CombatLegalActionPayload } from '../src/contracts/tacticalCombat';
import {
  isCombatActionTargetReady,
  resolveCombatActionTarget,
} from '../src/game/combat/combatTargeting';

const action = (
  targeting: CombatLegalActionPayload['targeting'],
  targetActorIds: string[],
): CombatLegalActionPayload => ({
  action: 'SKILL',
  skillKey: 'test-skill',
  targeting,
  targetActorIds,
});

describe('combat target resolution', () => {
  it('uses the selected target when it is legal for the action', () => {
    expect(resolveCombatActionTarget(action('ENEMY', ['enemy-a', 'enemy-b']), 'enemy-b')).toEqual({
      ready: true,
      targetActorId: 'enemy-b',
    });
  });

  it('does not silently replace an invalid selection when multiple explicit targets exist', () => {
    expect(resolveCombatActionTarget(action('ALLY', ['ally-a', 'ally-b']), 'enemy-a')).toEqual({
      ready: false,
    });
  });

  it('automatically resolves a sole legal target', () => {
    expect(resolveCombatActionTarget(action('ENEMY', ['enemy-a']), 'ally-a')).toEqual({
      ready: true,
      targetActorId: 'enemy-a',
    });
  });

  it('allows self and group-targeted actions without matching the current selection', () => {
    expect(isCombatActionTargetReady(action('SELF', ['self']), 'enemy-a')).toBe(true);
    expect(
      isCombatActionTargetReady(action('ALL_ENEMIES', ['enemy-a', 'enemy-b']), 'ally-a'),
    ).toBe(true);
  });

  it('rejects actions without any legal target', () => {
    expect(isCombatActionTargetReady(action('ENEMY', []), undefined)).toBe(false);
  });
});
