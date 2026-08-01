import { describe, expect, it } from 'vitest';
import '../src/modules/skills/tactical-skill-bootstrap.js';
import { TACTICAL_CONTENT_VERSION, compileCurrentTacticalContent } from '../src/content/tactical-content.compiler.js';
import { SKILL_CATALOG } from '../src/modules/skills/skill.catalog.js';

const skill = (key: string) => {
  const definition = SKILL_CATALOG.find((candidate) => candidate.key === key);
  if (!definition) throw new Error(`Missing skill ${key}`);
  return definition;
};

describe('tactical skill ruleset', () => {
  it('adds production telegraphs with explicit legal counters', () => {
    for (const key of [
      'mage-meteor',
      'mage-elemental-cataclysm',
      'warrior-unbreakable-assault',
      'archer-rain-of-arrows',
    ]) {
      expect(skill(key).telegraph).toMatchObject({
        reactionWindowMs: 4_000,
        publicIntent: expect.any(String),
        counters: expect.any(Array),
      });
      expect(skill(key).telegraph?.counters.length).toBeGreaterThan(0);
    }
  });

  it('uses explicit row and team target scopes for production skills', () => {
    expect(skill('warrior-cleave').targeting).toBe('FRONT_ROW');
    expect(skill('warrior-battle-cry').targeting).toBe('ALL_ALLIES');
    expect(skill('mage-meteor').targeting).toBe('ALL_ENEMIES');
    expect(skill('archer-rain-of-arrows').targeting).toBe('ALL_ENEMIES');
  });

  it('provides three data-driven setup and finisher relationships', () => {
    const markEffects = skill('archer-predators-mark').effects;
    expect(markEffects).toContainEqual(
      expect.objectContaining({ type: 'APPLY_STATUS', statusKey: 'EXPOSED' }),
    );
    expect(skill('warrior-execution').effects).toContainEqual(
      expect.objectContaining({ type: 'DAMAGE', consumesStatusKey: 'EXPOSED' }),
    );
    expect(skill('archer-perfect-hunt').effects).toContainEqual(
      expect.objectContaining({
        type: 'DAMAGE',
        consumesStatusKey: 'DAMAGE_TAKEN_INCREASE',
      }),
    );
  });

  it('compiles telegraphs into a stable versioned manifest', async () => {
    const first = await compileCurrentTacticalContent({ realmSlug: 'world-1', realmName: 'World 1' });
    const second = await compileCurrentTacticalContent({ realmSlug: 'world-1', realmName: 'World 1' });
    expect(first.manifest.version).toBe(TACTICAL_CONTENT_VERSION);
    expect(first.sourceHash).toBe(second.sourceHash);
    expect(first.manifest.skills.find((entry) => entry.key === 'mage-meteor')?.telegraph).toMatchObject({
      reactionWindowMs: 4_000,
      interruptible: true,
    });
  });
});
