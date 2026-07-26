import { z } from 'zod';
import { CHARACTER_CLASSES, DIRECTIONS } from '../common/domain/game.types.js';

export const createCharacterSchema = z.object({
  requestId: z.string().min(1).max(64),
  name: z
    .string()
    .trim()
    .min(3)
    .max(20)
    .regex(/^[A-Za-z][A-Za-z0-9 _-]*$/),
  characterClass: z.enum(CHARACTER_CLASSES),
});

export const moveStepSchema = z.object({
  requestId: z.string().min(1).max(64),
  direction: z.enum(DIRECTIONS),
});

export const moveTargetSchema = z.object({
  requestId: z.string().min(1).max(64),
  targetX: z.number().int(),
  targetY: z.number().int(),
});

export const moveStopSchema = z.object({
  requestId: z.string().min(1).max(64).optional(),
});

export const viewportUpdateSchema = z.object({
  requestId: z.string().min(1).max(64),
  halfWidth: z.number().int().min(1).max(128),
  halfHeight: z.number().int().min(1).max(128),
});

export type CreateCharacterPayload = z.infer<typeof createCharacterSchema>;
export type MoveStepPayload = z.infer<typeof moveStepSchema>;
export type MoveTargetPayload = z.infer<typeof moveTargetSchema>;
export type MoveStopPayload = z.infer<typeof moveStopSchema>;
export type ViewportUpdatePayload = z.infer<typeof viewportUpdateSchema>;
