import { z } from 'zod';

const ratio = z.number().min(0).max(1);
const conditionSchema = z.object({
  actorHpBelow: ratio.optional(),
  actorHpAbove: ratio.optional(),
  targetHpBelow: ratio.optional(),
  turnAtLeast: z.number().int().positive().optional(),
  requiredStatus: z.string().trim().min(1).optional(),
  forbiddenStatus: z.string().trim().min(1).optional(),
});

const telegraphSchema = z.object({
  key: z.string().trim().min(1).max(128),
  resolveAfterTurns: z.number().int().min(1).max(20),
  counterKinds: z
    .array(z.enum(['INTERRUPT', 'GUARD', 'CLEANSE', 'POSITION']))
    .min(1),
  publicMetadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

const actionSchema = z
  .object({
    action: z.enum(['BASIC_ATTACK', 'SKILL']),
    skillKey: z.string().trim().min(1).optional(),
    target: z.enum([
      'LOWEST_HP_RATIO',
      'HIGHEST_HP_RATIO',
      'LOWEST_ARMOR',
      'RANDOM_ENEMY',
      'SELF',
    ]),
    priority: z.number().int().min(-1000).max(1000).default(0),
    weight: z.number().positive().max(1_000_000).default(1),
    condition: conditionSchema.optional(),
    telegraph: telegraphSchema.optional(),
  })
  .superRefine((action, context) => {
    if (action.action === 'SKILL' && !action.skillKey) {
      context.addIssue({ code: 'custom', path: ['skillKey'], message: 'SKILL action requires skillKey.' });
    }
    if (action.action === 'BASIC_ATTACK' && action.skillKey) {
      context.addIssue({ code: 'custom', path: ['skillKey'], message: 'BASIC_ATTACK cannot define skillKey.' });
    }
  });

export const mobAiProfileSchema = z
  .object({
    version: z.literal(1),
    phases: z
      .array(
        z.object({
          key: z.string().trim().min(1).max(128),
          startsAtHpRatio: ratio,
          actions: z.array(actionSchema).min(1),
        }),
      )
      .min(1),
  })
  .superRefine((profile, context) => {
    const keys = new Set<string>();
    profile.phases.forEach((phase, index) => {
      if (keys.has(phase.key)) {
        context.addIssue({ code: 'custom', path: ['phases', index, 'key'], message: 'Duplicate phase key.' });
      }
      keys.add(phase.key);
    });
    if (!profile.phases.some((phase) => phase.startsAtHpRatio === 1)) {
      context.addIssue({ code: 'custom', path: ['phases'], message: 'A phase starting at HP ratio 1 is required.' });
    }
  });
