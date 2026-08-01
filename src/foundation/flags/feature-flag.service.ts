import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  selectFeatureVariant,
  stableFeatureBucket,
  validateFeatureVariants,
  type FeatureFlagScope,
  type FeatureFlagVariant,
} from './feature-flag.assignments.js';

export interface FeatureFlagEvaluation {
  key: string;
  version: number;
  scope: FeatureFlagScope;
  subjectId: string;
  enabled: boolean;
  variant: string;
  bucket: number;
  assignedAt?: Date;
}

interface FlagRow {
  key: string;
  version: number;
  scope: FeatureFlagScope;
  enabled: boolean;
  rolloutBasisPoints: number;
  variants: unknown;
  salt: string;
}

interface AssignmentRow {
  bucket: number;
  variant: string;
  assignedAt: Date;
}

@Injectable()
export class FeatureFlagService {
  constructor(private readonly prisma: PrismaService) {}

  async evaluate(
    key: string,
    version: number,
    scope: FeatureFlagScope,
    subjectId: string,
  ): Promise<FeatureFlagEvaluation> {
    if (!key.trim() || !subjectId.trim()) throw new Error('Feature flag key and subject ID are required.');
    if (!Number.isInteger(version) || version <= 0) throw new Error('Feature flag version must be positive.');

    return this.prisma.$transaction(async (transaction) => {
      const flags = await transaction.$queryRaw<FlagRow[]>(Prisma.sql`
        SELECT "key", "version", "scope", "enabled", "rolloutBasisPoints", "variants", "salt"
        FROM "FeatureFlag"
        WHERE "key" = ${key} AND "version" = ${version}
        LIMIT 1
      `);
      const flag = flags[0];
      if (!flag || !flag.enabled) {
        return { key, version, scope, subjectId, enabled: false, variant: 'control', bucket: -1 };
      }
      if (flag.scope !== scope) {
        throw new Error(`Feature flag ${key}@${version} expects ${flag.scope} scope, received ${scope}.`);
      }

      const readAssignment = async (): Promise<AssignmentRow | undefined> => {
        const rows = await transaction.$queryRaw<AssignmentRow[]>(Prisma.sql`
          SELECT "bucket", "variant", "assignedAt"
          FROM "FeatureFlagAssignment"
          WHERE "flagKey" = ${key}
            AND "flagVersion" = ${version}
            AND "scope" = ${scope}
            AND "subjectId" = ${subjectId}
          LIMIT 1
        `);
        return rows[0];
      };
      const existing = await readAssignment();
      if (existing) return this.toEvaluation(key, version, scope, subjectId, existing);

      const bucket = stableFeatureBucket(`${flag.salt}:${key}:${version}:${scope}:${subjectId}:rollout`);
      const included = bucket < flag.rolloutBasisPoints;
      const variantBucket = stableFeatureBucket(`${flag.salt}:${key}:${version}:${scope}:${subjectId}:variant`);
      const variant = included
        ? selectFeatureVariant(validateFeatureVariants(flag.variants), variantBucket)
        : '__off__';
      await transaction.$executeRaw(Prisma.sql`
        INSERT INTO "FeatureFlagAssignment" (
          "id", "flagKey", "flagVersion", "scope", "subjectId", "bucket", "variant"
        ) VALUES (
          ${randomUUID()}::uuid, ${key}, ${version}, ${scope}, ${subjectId}, ${bucket}, ${variant}
        )
        ON CONFLICT ("flagKey", "flagVersion", "scope", "subjectId") DO NOTHING
      `);
      const stored = await readAssignment();
      if (!stored) throw new Error('Feature flag assignment could not be persisted.');
      return this.toEvaluation(key, version, scope, subjectId, stored);
    });
  }

  async createVersion(input: {
    key: string;
    version: number;
    scope: FeatureFlagScope;
    enabled?: boolean;
    rolloutBasisPoints: number;
    variants: readonly FeatureFlagVariant[];
    salt?: string;
  }): Promise<void> {
    const variants = validateFeatureVariants(input.variants);
    if (!Number.isInteger(input.version) || input.version <= 0) throw new Error('Feature flag version must be positive.');
    if (!Number.isInteger(input.rolloutBasisPoints) || input.rolloutBasisPoints < 0 || input.rolloutBasisPoints > 10_000) {
      throw new Error('Feature flag rollout must be between 0 and 10000 basis points.');
    }
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO "FeatureFlag" (
        "id", "key", "version", "scope", "enabled", "rolloutBasisPoints", "variants", "salt"
      ) VALUES (
        ${randomUUID()}::uuid,
        ${input.key},
        ${input.version},
        ${input.scope},
        ${input.enabled ?? false},
        ${input.rolloutBasisPoints},
        CAST(${JSON.stringify(variants)} AS jsonb),
        ${input.salt ?? randomUUID()}
      )
    `);
  }

  async disableImmediately(key: string, version: number): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE "FeatureFlag"
      SET "enabled" = FALSE, "disabledAt" = CURRENT_TIMESTAMP
      WHERE "key" = ${key} AND "version" = ${version}
    `);
  }

  private toEvaluation(
    key: string,
    version: number,
    scope: FeatureFlagScope,
    subjectId: string,
    assignment: AssignmentRow,
  ): FeatureFlagEvaluation {
    return {
      key,
      version,
      scope,
      subjectId,
      enabled: assignment.variant !== '__off__',
      variant: assignment.variant === '__off__' ? 'control' : assignment.variant,
      bucket: assignment.bucket,
      assignedAt: assignment.assignedAt,
    };
  }
}
