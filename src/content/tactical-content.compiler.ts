import '../modules/skills/tactical-skill-bootstrap.js';
import { SKILL_CATALOG } from '../modules/skills/skill.catalog.js';
import {
  compileCurrentContent,
  contentHash,
  type CompiledContentPackage,
} from './content-package.compiler.js';

export const TACTICAL_CONTENT_VERSION = '2026.08.01.3';

export async function compileCurrentTacticalContent(options: {
  realmSlug: string;
  realmName: string;
}): Promise<CompiledContentPackage> {
  const compiled = await compileCurrentContent(options);
  const definitions = new Map(SKILL_CATALOG.map((skill) => [skill.key, skill]));
  const manifest = {
    ...compiled.manifest,
    version: TACTICAL_CONTENT_VERSION,
    skills: compiled.manifest.skills.map((skill) => {
      const definition = definitions.get(skill.key);
      return {
        ...skill,
        ...(definition?.telegraph
          ? {
              telegraph: {
                reactionWindowMs: definition.telegraph.reactionWindowMs,
                publicIntent: definition.telegraph.publicIntent,
                interruptible: definition.telegraph.interruptible,
                counters: [...definition.telegraph.counters],
              },
            }
          : {}),
      };
    }),
  };
  return { manifest, sourceHash: contentHash(manifest) };
}
