import { describe, expect, it } from 'vitest';
import type { CombatActionResolutionPayload } from '../src/contracts/socket';
import {
  actionDamageFor,
  getCombatVfxFamily,
  isSelfCastCombatAction,
  usesAttackMotion,
} from '../src/game/combat/combatPresentation';

const combatResult = (targetActorId: string) => ({
  targetActorId,
  hpDelta: 0,
  energyDelta: 0,
  shieldDelta: 20,
  shieldAbsorbed: 0,
  dodged: false,
  statusesApplied: [],
  statusesRemoved: [],
});

const skillAction = (
  targetActorId: string,
  results = [combatResult(targetActorId)],
): CombatActionResolutionPayload => ({
  sequence: 1,
  actorId: 'player:1',
  targetActorId,
  action: 'SKILL',
  skillKey: 'test-skill',
  label: 'Test skill',
  animationKey: 'test-skill',
  visual: {
    castEffectKey: 'test-skill:cast',
    impactEffectKey: 'test-skill:impact',
    accentColor: '#facc15',
  },
  results,
  occurredAt: 1,
});

describe('combat presentation', () => {
  it('routes stable animation keys to distinct VFX families', () => {
    expect(getCombatVfxFamily('mage-flame-orb')).toBe('fire');
    expect(getCombatVfxFamily('mage-frost-nova')).toBe('frost');
    expect(getCombatVfxFamily('mage-arcane-spark')).toBe('arcane');
    expect(getCombatVfxFamily('archer-quick-shot')).toBe('projectile');
    expect(getCombatVfxFamily('warrior-whirlwind')).toBe('physical');
  });

  it('uses a support aura and no attack motion for self-cast skills', () => {
    const selfCast = skillAction('player:1');

    expect(isSelfCastCombatAction(selfCast)).toBe(true);
    expect(usesAttackMotion(selfCast)).toBe(false);
    expect(getCombatVfxFamily(selfCast)).toBe('support');
  });

  it('keeps attack movement for enemy-targeted skills', () => {
    const offensive = skillAction('mob:1');

    expect(isSelfCastCombatAction(offensive)).toBe(false);
    expect(usesAttackMotion(offensive)).toBe(true);
  });

  it('keeps attack movement for basic attacks', () => {
    const basic: CombatActionResolutionPayload = {
      sequence: 2,
      actorId: 'player:1',
      targetActorId: 'mob:1',
      action: 'BASIC_ATTACK',
      label: 'Basic attack',
      animationKey: 'basic-attack',
      visual: {
        castEffectKey: 'basic-attack:cast',
        impactEffectKey: 'basic-attack:impact',
        accentColor: '#f5d88a',
      },
      results: [combatResult('mob:1')],
      occurredAt: 2,
    };

    expect(usesAttackMotion(basic)).toBe(true);
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
