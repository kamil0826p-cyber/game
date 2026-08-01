import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';
import {
  featureFlagBucket,
  featureFlagVariantBucket,
  selectFeatureFlagVariant,
  validateFeatureFlagDefinition,
  type FeatureFlagDefinitionInput,
  type FeatureFlagResolution,
  type FeatureFlagScope,
  type FeatureFlagVariant,
} from './feature-flag.assignment.js';

export type {
  FeatureFlagDefinitionInput,
  FeatureFlagResolution,
  FeatureFlagScope,
  FeatureFlagVariant,
} from './feature-flag.assignment.js';
export {
  featureFlagBucket,
  featureFlagVariantBucket,
  selectFeatureFlagVariant,
} from './feature-flag.assignment.js';

const parseVariants = (value: Prisma.JsonValue): FeatureFlagVariant[] => {
  if (!Array.isArray(value)) throw new Error('Stored feature flag variants are invalid.');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error('Stored feature flag variant is invalid.');
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.key !== 'string' || typeof candidate.weight !== 'number') {
      throw new Error('Stored feature flag variant is invalid.');
    }
    return { key: candidate.key, weight: candidate.weight };
  });
};

@Injectable()
export class FeatureFlagService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(definition: FeatureFlagDefinitionInput): Promise<void> {
    validateFeatureFlagDefinition(definition);
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key_version: { key: definition.key, version: definition.version } },
    });
    if (existing) {
      const immutableMatches =
        existing.scope === definition.scope &&
        existing.salt === definition.salt &&
        JSON.stringify(existing.variants) === JSON.stringify(definition.variants);
      if (!immutableMatches) {
        throw new Error(
          `Feature flag ${definition.key}@${definition.version} is immutable; publish a new version.`,
        );
      }
      await this.prisma.featureFlag.update({
        where: { id: existing.id },
        data: {
          enabled: definition.enabled,
          rolloutPercentage: definition.rolloutPercentage,
          disabledAt: definition.enabled ? null : new Date(),
        },
      });
      return;
    }

    await this.prisma.featureFlag.create({
      data: {
        key: definition.key,
        version: definition.version,
        scope: definition.scope,
        enabled: definition.enabled,
        rolloutPercentage: definition.rolloutPercentage,
        salt: definition.salt,
        variants: definition.variants as unknown as Prisma.InputJsonValue,
        disabledAt: definition.enabled ? null : new Date(),
      },
    });
  }

  async disable(key: string, version: number): Promise<void> {
    await this.prisma.featureFlag.update({
      where: { key_version: { key, version } },
      data: { enabled: false, disabledAt: new Date() },
    });
  }

  async resolve(
    key: string,
    version: number,
    scope: FeatureFlagScope,
    scopeId: string,
  ): Promise<FeatureFlagResolution> {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { key_version: { key, version } },
    });
    if (!flag) throw new Error(`Unknown feature flag ${key}@${version}.`);
    if (flag.scope !== scope) {
      throw new Error(`Feature flag ${key}@${version} expects scope ${flag.scope}, not ${scope}.`);
    }
    if (!flag.enabled) {
      return { variant: 'control', bucket: -1, assigned: false, disabled: true };
    }

    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.featureFlagAssignment.findUnique({
        where: { featureFlagId_scopeId: { featureFlagId: flag.id, scopeId } },
      });
      if (existing) {
        return {
          variant: existing.variant,
          bucket: existing.bucket,
          assigned: true,
          disabled: false,
        };
      }

      const immutableIdentity = {
        key: flag.key,
        version: flag.version,
        salt: flag.salt,
        scope: flag.scope,
      };
      const bucket = featureFlagBucket(immutableIdentity, scopeId);
      const included = bucket < Math.round(flag.rolloutPercentage * 100);
      if (!included) {
        return { variant: 'control', bucket, assigned: false, disabled: false };
      }

      const variant = selectFeatureFlagVariant(
        parseVariants(flag.variants),
        featureFlagVariantBucket(immutableIdentity, scopeId),
      );
      const assignment = await transaction.featureFlagAssignment.upsert({
        where: { featureFlagId_scopeId: { featureFlagId: flag.id, scopeId } },
        create: { featureFlagId: flag.id, scopeId, variant, bucket },
        update: {},
      });
      return {
        variant: assignment.variant,
        bucket: assignment.bucket,
        assigned: true,
        disabled: false,
      };
    });
  }
}
