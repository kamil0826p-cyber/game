import { z } from 'zod';
import { PROGRESSION_NODE_KEYS } from './progression.types.js';

const requestId = z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9:_-]+$/);

export const progressionGetSchema = z.object({ requestId }).strict();
export const progressionChooseSchema = z.object({
  requestId,
  nodeKey: z.enum(PROGRESSION_NODE_KEYS),
}).strict();
export const progressionRespecSchema = z.object({ requestId }).strict();

export type ProgressionGetPayload = z.infer<typeof progressionGetSchema>;
export type ProgressionChoosePayload = z.infer<typeof progressionChooseSchema>;
export type ProgressionRespecPayload = z.infer<typeof progressionRespecSchema>;
