import { describe, expect, it } from 'vitest';
import type { CombatActionResolutionPayload } from '../src/contracts/socket';
import {
  actionDamageFor,
  getCombatVfxFamily,
  hasDirectOffensiveImpact,
  isSelfCastCombatAction,
  usesAttackMotion,
  usesCombatProjectile,
} from '../src/game/combat/combatPresentation';

type CombatResult = CombatActionResolutionPayload['results'][number];

const combatResult = (
  targetActorId: string,
  overrides: Partial<CombatResult> = {},
): CombatResult => ({
  targetActorId,
  hpDelta: 0,
  energyDelta: 0,
  shieldDelta: 0,
  shieldAbsorbed: 0,
  dodged: false,
  statusesApplied: [],
  statusesRemoved: [],
  ...overrides,
});

const skillAction = ({
  targetActorId,
  results,
  skillKey = 'test-skill',
  animationKey = 'test-skill',
  projectileEffectKey,
}: {
  targetActorId?: string;
  results: CombatResult[];
  skillKey?: string;
  animationKey?: string;
  projectileEffectKey?: string;
}): CombatActionResolutionPayload => ({
  sequence: 1,
  actorId: 'player:1',
  targetActorId,
  action: 'SKILL',
  skillKey,
  label: 'Test skill',
  animationKey,
  visual: {
    castEffectKey: `${animationKey}:cast`,
    projectileEffectKey,
    impactEffectKey: `${animationKey}:impact`,
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
    const selfCast = skillAction({
      targetActorId: 'player:1',
      results: [combatResult('player:1', { shieldDelta: 20 })],
    });

    expect(isSelfCastCombatAction(selfCast)).toBe(true);
    expect(hasDirectOffensiveImpact(selfCast)).toBe(false);
    expect(usesAttackMotion(selfCast)).toBe(false);
    expect(usesCombatProjectile(selfCast)).toBe(false);
    expect(getCombatVfxFamily(selfCast)).toBe('support');
  });

  it('keeps attack movement for skills that directly damage a target', () => {
    const offensive = skillAction({
      targetActorId: 'mob:1',
      results: [combatResult('mob:1', { hpDelta: -18 })],
    });

    expect(hasDirectOffensiveImpact(offensive)).toBe(true);
    expect(usesAttackMotion(offensive)).toBe(true);
  });

  it('keeps attack movement when damage is absorbed or dodged', () => {
    const absorbed = skillAction({
      targetActorId: 'mob:1',
      results: [combatResult('mob:1', { shieldAbsorbed: 12 })],
    });
    const dodged = skillAction({
      targetActorId: 'mob:1',
      results: [combatResult('mob:1', { dodged: true })],
    });

    expect(usesAttackMotion(absorbed)).toBe(true);
    expect(usesAttackMotion(dodged)).toBe(true);
  });

  it('does not make ritual, summon or phase events look like attacks', () => {
    const ritual = skillAction({
      results: [combatResult('summoned-mob:1'), combatResult('summoned-mob:2')],
      skillKey: 'encounter:summon',
      animationKey: 'encounter-summon',
    });

    expect(isSelfCastCombatAction(ritual)).toBe(false);
    expect(hasDirectOffensiveImpact(ritual)).toBe(false);
    expect(usesAttackMotion(ritual)).toBe(false);
    expect(usesCombatProjectile(ritual)).toBe(false);
    expect(getCombatVfxFamily(ritual)).toBe('support');
  });

  it('does not use attack movement for tactical and ally-support actions', () => {
    const mark = skillAction({
      targetActorId: 'player:2',
      results: [
        combatResult('player:2', {
          statusesApplied: [{ key: 'EXPOSED', turnsRemaining: 2 }],
        }),
      ],
      skillKey: 'tactical:mark',
      animationKey: 'tactical-mark',
    });
    const allyShield = skillAction({
      targetActorId: 'player:2',
      results: [combatResult('player:2', { shieldDelta: 25 })],
      skillKey: 'mage-ally-barrier',
      animationKey: 'mage-ally-barrier',
    });

    expect(usesAttackMotion(mark)).toBe(false);
    expect(usesCombatProjectile(mark)).toBe(false);
    expect(getCombatVfxFamily(mark)).toBe('status');
    expect(usesAttackMotion(allyShield)).toBe(false);
  });

  it('allows an explicit spell projectile without forcing actor attack movement', () => {
    const controlSpell = skillAction({
      targetActorId: 'mob:1',
      results: [
        combatResult('mob:1', {
          statusesApplied: [{ key: 'STUNNED', turnsRemaining: 1 }],
        }),
      ],
      skillKey: 'mage-time-lock',
      animationKey: 'mage-time-lock',
      projectileEffectKey: 'vfx:time-rift',
    });

    expect(hasDirectOffensiveImpact(controlSpell)).toBe(false);
    expect(usesAttackMotion(controlSpell)).toBe(false);
    expect(usesCombatProjectile(controlSpell)).toBe(true);
    expect(getCombatVfxFamily(controlSpell)).toBe('arcane');
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
        projectileEffectKey: 'vfx:weapon-trail',
        impactEffectKey: 'basic-attack:impact',
        accentColor: '#f5d88a',
      },
      results: [combatResult('mob:1')],
      occurredAt: 2,
    };

    expect(usesAttackMotion(basic)).toBe(true);
    expect(usesCombatProjectile(basic)).toBe(true);
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
