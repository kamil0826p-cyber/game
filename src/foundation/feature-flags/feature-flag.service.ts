import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';

export type FeatureFlagScope = 'ACCOUNT' | 'CHARACTER' | 'REALM' | 'GROUP' | 'GUILD';

export interface FeatureFlagVariant {
  key: string;
  weight: number;
}

export interface FeatureFlagDefinitionInput {
  key: string;
  version: number;
  scope: FeatureFlagScope;
  enabled: boolean;
  rolloutPercentage: number;
  salt: string;
  variants: readonly FeatureFlagVariant[];
}

export interface FeatureFlagResolution {
  variant: string;
  bucket: number;
  assigned: boolean;
  disabled: boolean;
}

const validateDefinition = (definition: FeatureFlagDefinitionInput): void => {
  if (!definition.key.trim()) throw new Error('Feature flag key is required.');
  if (!Number.isInteger(definition.version) || definition.version < 1) throw new Error('Feature flag version must be a positive integer.');
  if (definition.rolloutPercentage < 0 || definition.rolloutPercentage > 100) throw new Error('Feature flag rolloutPercentage must be between 0 and 100.');
  if (definition.variants.length === 0) throw new Error('Feature flag must define at least one variant.');
  if (new Set(definition.variants.map((variant) => variant.key)).size !== definition.variants.length) throw new Error('Feature flag variant keys must be unique.');
  if (definition.variants.some((variant) => !variant.key || variant.weight <= 0)) throw new Error('Feature flag variant weights must be positive.');
};

export const featureFlagBucket = (
  definition: Pick<FeatureFlagDefinitionInput, 'key' | 'version' | 'salt' | 'scope'>,
  scopeId: string,
): number => {
  const digest = createHash('sha256')
    .update(`${definition.salt}:${definition.key}:${definition.version}:${definition.scope}:${scopeId}`)
    .digest();
  return digest.readUInt32BE(0) % 10_000;
};

export const selectFeatureFlagVariant = (
  variants: readonly FeatureFlagVariant[],
  bucket: number,
): string => {
  const totalWeight = variants.reduce((sum, variant) => sum + variant.weight, 0);
  const weightedBucket = (bucket / 10_000) * totalWeight;
  let cursor = 0;
  for (const variant of variants) {
    cursor += variant.weight;
    if (weightedBucket < cursor) return variant.key;
  }
  return variants.at(-1)!.key;
};

const parseVariants = (value: Prisma.JsonValue): FeatureFlagVariant[] => {
  if (!Array.isArray(value)) throw new Error('Stored feature flag variants are invalid.');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Stored feature flag variant is invalid.');
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.key !== 'string' || typeof candidate.weight !== 'number') throw new Error('Stored feature flag variant is invalid.');
    return { key: candidate.key, weight: candidate.weight };
  });
};

@Injectable()
export class FeatureFlagService {
  constructor(private readonly prisma: PrismaService) {}

  async publish(definition: FeatureFlagDefinitionInput): Promise<void> {
    validateDefinition(definition);
    const existing = await this.prisma.featureFlag.findUnique({
      where: { key_version: { key: definition.key, version: definition.version } },
    });
    if (existing) {
      const immutableMatches =
        existing.scope === definition.scope &&
        existing.salt === definition.salt &&
        JSON.stringify(existing.variants) === JSON.stringify(definition.variants);
      if (!immutableMatches) throw new Error(`Feature flag ${definition.key}@${definition.version} is immutable; publish a new version.`);
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

  async resolve(key: string, version: number, scope: FeatureFlagScope, scopeId: string): Promise<FeatureFlagResolution> {
    const flag = await this.prisma.featureFlag.findUnique({
      where: { key_version: { key, version } },
    });
    if (!flag) throw new Error(`Unknown feature flag ${key}@${version}.`);
    if (flag.scope !== scope) throw new Error(`Feature flag ${key}@${version} expects scope ${flag.scope}, not ${scope}.`);
    if (!flag.enabled) return { variant: 'control', bucket: -1, assigned: false, disabled: true };

    return this.prisma.$transaction(async (transaction) => {
      const existing = await transaction.featureFlagAssignment.findUnique({
        where: { featureFlagId_scopeId: { featureFlagId: flag.id, scopeId } },
      });
      if (existing) {
        return { variant: existing.variant, bucket: existing.bucket, assigned: true, disabled: false };
      }

      const bucket = featureFlagBucket(
        { key: flag.key, version: flag.version, salt: flag.salt, scope: flag.scope },
        scopeId,
      );
      const included = bucket < Math.round(flag.rolloutPercentage * 100);
      const variant = included ? selectFeatureFlagVariant(parseVariants(flag.variants), bucket) : 'control';
      const assignment = await transaction.featureFlagAssignment.upsert({
        where: { featureFlagId_scopeId: { featureFlagId: flag.id, scopeId } },
        create: { featureFlagId: flag.id, scopeId, variant, bucket },
        update: {},
      });
      return { variant: assignment.variant, bucket: assignment.bucket, assigned: true, disabled: false };
    });
  }
}
