import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { ExperimentDefinition, ExperimentSubjectType, ExperimentVariant } from './analytics.types.js';

interface RawExperiment {
  key: string;
  version: number;
  status: 'ACTIVE' | 'DISABLED';
  rolloutBasisPoints: number;
  variants: Prisma.JsonValue;
  salt: string;
  startsAt: Date | null;
  endsAt: Date | null;
}

function validateVariants(variants: readonly ExperimentVariant[]): void {
  if (variants.length < 1 || variants.length > 20) throw new Error('Experiment must define 1-20 variants.');
  const keys = new Set<string>();
  let total = 0;
  for (const variant of variants) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(variant.key) || keys.has(variant.key)) {
      throw new Error(`Invalid or duplicate experiment variant ${variant.key}.`);
    }
    if (!Number.isInteger(variant.weight) || variant.weight < 1) throw new Error('Experiment weights must be positive integers.');
    keys.add(variant.key);
    total += variant.weight;
  }
  if (total !== 10_000) throw new Error('Experiment variant weights must total 10000 basis points.');
}

export function selectExperimentVariant(
  definition: Pick<ExperimentDefinition, 'key' | 'version' | 'rolloutBasisPoints' | 'variants' | 'salt'>,
  subjectId: string,
): string {
  validateVariants(definition.variants);
  if (definition.rolloutBasisPoints < 0 || definition.rolloutBasisPoints > 10_000) {
    throw new Error('Experiment rollout must be 0-10000 basis points.');
  }
  const digest = createHash('sha256')
    .update(`${definition.salt}:${definition.key}:${definition.version}:${subjectId}`)
    .digest();
  const rolloutBucket = digest.readUInt32BE(0) % 10_000;
  if (rolloutBucket >= definition.rolloutBasisPoints) return 'control';
  const variantBucket = digest.readUInt32BE(4) % 10_000;
  let cursor = 0;
  for (const variant of definition.variants) {
    cursor += variant.weight;
    if (variantBucket < cursor) return variant.key;
  }
  return definition.variants.at(-1)!.key;
}

@Injectable()
export class AnalyticsExperimentService {
  constructor(private readonly prisma: PrismaService) {}

  async assignment(input: {
    experimentKey: string;
    subjectType: ExperimentSubjectType;
    subjectId: string;
  }): Promise<{ variant: string; experimentVersion?: number }> {
    const rows = await this.prisma.$queryRaw<RawExperiment[]>(Prisma.sql`
      SELECT "key", "version", "status", "rolloutBasisPoints", "variants", "salt", "startsAt", "endsAt"
      FROM "AnalyticsExperiment"
      WHERE "key" = ${input.experimentKey} AND "status" = 'ACTIVE'
        AND ("startsAt" IS NULL OR "startsAt" <= NOW())
        AND ("endsAt" IS NULL OR "endsAt" > NOW())
      ORDER BY "version" DESC LIMIT 1
    `);
    const raw = rows[0];
    if (!raw) return { variant: 'control' };
    const definition: ExperimentDefinition = {
      ...raw,
      variants: raw.variants as unknown as ExperimentVariant[],
    };
    const variant = selectExperimentVariant(definition, input.subjectId);
    const assigned = await this.prisma.$queryRaw<Array<{ variant: string }>>(Prisma.sql`
      INSERT INTO "AnalyticsExperimentAssignment" (
        "id", "experimentKey", "experimentVersion", "subjectType", "subjectId", "variant", "assignedAt"
      ) VALUES (
        ${randomUUID()}::uuid, ${definition.key}, ${definition.version}, ${input.subjectType},
        ${input.subjectId}::uuid, ${variant}, NOW()
      ) ON CONFLICT ("experimentKey", "experimentVersion", "subjectType", "subjectId")
        DO UPDATE SET "variant" = "AnalyticsExperimentAssignment"."variant"
      RETURNING "variant"
    `);
    return { variant: assigned[0]?.variant ?? variant, experimentVersion: definition.version };
  }
}
