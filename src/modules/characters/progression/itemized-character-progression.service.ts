import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  calculateCharacterStats,
  MILESTONE_KEYS,
  preserveResourceRatio,
  PROGRESSION_STAT_KEYS,
  ZERO_PROGRESSION_STATS,
  type MilestoneRanks,
  type ProgressionStatVector,
} from './character-progression.rules.js';
import {
  CharacterProgressionService,
  type CharacterStatCache,
} from './character-progression.service.js';
import type {
  CharacterProgressionSnapshot,
  ProgressionMigrationResult,
} from './character-progression.types.js';
import {
  effectiveItemStatBonuses,
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
} from '../../items/itemization.rules.js';

@Injectable()
export class ItemizedCharacterProgressionService extends CharacterProgressionService {
  constructor(private readonly database: PrismaService) {
    super(database);
  }

  override async ensureCanonical(characterId: string): Promise<CharacterStatCache> {
    const base = await super.ensureCanonical(characterId);
    return this.database.$transaction((transaction) =>
      this.applyItemizedStats(transaction, characterId, base, false),
    );
  }

  override async recomputeInTransaction(
    transaction: Prisma.TransactionClient,
    characterId: string,
    options: { preserveAbsoluteResources?: boolean } = {},
  ): Promise<CharacterStatCache> {
    const base = await super.recomputeInTransaction(transaction, characterId, options);
    return this.applyItemizedStats(
      transaction,
      characterId,
      base,
      options.preserveAbsoluteResources ?? false,
    );
  }

  override async getSnapshot(
    userId: string,
    characterId: string,
  ): Promise<CharacterProgressionSnapshot> {
    const base = await super.getSnapshot(userId, characterId);
    const character = await this.database.character.findFirst({
      where: { id: characterId, userId },
      select: {
        hp: true,
        energy: true,
        silver: true,
        stateVersion: true,
        progressionData: true,
        inventoryItems: {
          where: { equippedSlot: { not: null } },
          include: { itemDefinition: true },
        },
      },
    });
    if (!character) return base;
    const progression = this.parseItemizedProgressionData(character.progressionData);
    const calculated = calculateCharacterStats({
      characterClass: base.characterClass,
      level: base.level,
      milestoneRanks: progression.milestones,
      equipment: this.itemizedEquipmentBonuses(character.inventoryItems),
      permanent: progression.permanent,
      temporary: progression.temporary,
      legacyAdjustment: progression.legacyAdjustment,
    });
    return {
      ...base,
      stateVersion: character.stateVersion,
      current: {
        hp: character.hp,
        energy: character.energy,
        silver: character.silver,
      },
      sources: calculated.sources,
      rawTotal: calculated.rawTotal,
      effective: calculated.effective,
      derived: calculated.derived,
    };
  }

  override async allocateMilestone(
    userId: string,
    characterId: string,
    milestoneKey: Parameters<CharacterProgressionService['allocateMilestone']>[2],
  ): Promise<CharacterProgressionSnapshot> {
    await super.allocateMilestone(userId, characterId, milestoneKey);
    await this.ensureCanonical(characterId);
    return this.getSnapshot(userId, characterId);
  }

  override async respec(
    userId: string,
    characterId: string,
    operationId: string,
    milestoneRanks: MilestoneRanks = {},
  ): Promise<CharacterProgressionSnapshot> {
    await super.respec(userId, characterId, operationId, milestoneRanks);
    await this.ensureCanonical(characterId);
    return this.getSnapshot(userId, characterId);
  }

  override async migrateAll(dryRun: boolean): Promise<ProgressionMigrationResult> {
    const result = await super.migrateAll(dryRun);
    if (!dryRun) {
      for (const characterId of result.characterIds) await this.ensureCanonical(characterId);
    }
    return result;
  }

  private async applyItemizedStats(
    transaction: Prisma.TransactionClient,
    characterId: string,
    base: CharacterStatCache,
    preserveAbsoluteResources: boolean,
  ): Promise<CharacterStatCache> {
    const character = await transaction.character.findUnique({
      where: { id: characterId },
      select: {
        id: true,
        class: true,
        level: true,
        experience: true,
        hp: true,
        maxHp: true,
        energy: true,
        maxEnergy: true,
        strength: true,
        agility: true,
        intelligence: true,
        armor: true,
        silver: true,
        stateVersion: true,
        progressionData: true,
        inventoryItems: {
          where: { equippedSlot: { not: null } },
          include: { itemDefinition: true },
        },
      },
    });
    if (!character) return base;
    const progression = this.parseItemizedProgressionData(character.progressionData);
    const calculated = calculateCharacterStats({
      characterClass: character.class,
      level: character.level,
      milestoneRanks: progression.milestones,
      equipment: this.itemizedEquipmentBonuses(character.inventoryItems),
      permanent: progression.permanent,
      temporary: progression.temporary,
      legacyAdjustment: progression.legacyAdjustment,
    });
    const nextHp = preserveAbsoluteResources
      ? Math.min(calculated.effective.maxHp, Math.max(0, base.hp))
      : preserveResourceRatio(base.hp, base.maxHp, calculated.effective.maxHp);
    const nextEnergy = preserveAbsoluteResources
      ? Math.min(calculated.effective.maxEnergy, Math.max(0, base.energy))
      : preserveResourceRatio(base.energy, base.maxEnergy, calculated.effective.maxEnergy);
    const changed =
      character.hp !== nextHp ||
      character.maxHp !== calculated.effective.maxHp ||
      character.energy !== nextEnergy ||
      character.maxEnergy !== calculated.effective.maxEnergy ||
      character.strength !== calculated.effective.strength ||
      character.agility !== calculated.effective.agility ||
      character.intelligence !== calculated.effective.intelligence ||
      character.armor !== calculated.effective.armor;
    if (!changed) {
      return {
        level: character.level,
        experience: character.experience,
        hp: character.hp,
        maxHp: character.maxHp,
        energy: character.energy,
        maxEnergy: character.maxEnergy,
        strength: character.strength,
        agility: character.agility,
        intelligence: character.intelligence,
        armor: character.armor,
        silver: character.silver,
        stateVersion: character.stateVersion,
      };
    }
    const updated = await transaction.character.update({
      where: { id: characterId },
      data: {
        hp: nextHp,
        maxHp: calculated.effective.maxHp,
        energy: nextEnergy,
        maxEnergy: calculated.effective.maxEnergy,
        strength: calculated.effective.strength,
        agility: calculated.effective.agility,
        intelligence: calculated.effective.intelligence,
        armor: calculated.effective.armor,
        stateVersion: { increment: 1 },
        lastSavedAt: new Date(),
      },
    });
    return {
      level: updated.level,
      experience: updated.experience,
      hp: updated.hp,
      maxHp: updated.maxHp,
      energy: updated.energy,
      maxEnergy: updated.maxEnergy,
      strength: updated.strength,
      agility: updated.agility,
      intelligence: updated.intelligence,
      armor: updated.armor,
      silver: updated.silver,
      stateVersion: updated.stateVersion,
    };
  }

  private itemizedEquipmentBonuses(
    items: ReadonlyArray<{
      instanceData: Prisma.JsonValue;
      itemDefinition: { key: string; metadata: Prisma.JsonValue };
    }>,
  ): ProgressionStatVector {
    const result = { ...ZERO_PROGRESSION_STATS };
    for (const item of items) {
      const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
      const snapshot = readItemInstanceSnapshot({
        instanceData: item.instanceData,
        definitionKey: item.itemDefinition.key,
        metadata,
      });
      const bonuses = effectiveItemStatBonuses(metadata, snapshot);
      for (const key of PROGRESSION_STAT_KEYS) {
        const value = bonuses[key];
        if (typeof value === 'number' && Number.isFinite(value)) result[key] += Math.trunc(value);
      }
    }
    return result;
  }

  private parseItemizedProgressionData(value: Prisma.JsonValue): {
    milestones: MilestoneRanks;
    legacyAdjustment: ProgressionStatVector;
    permanent: ProgressionStatVector;
    temporary: ProgressionStatVector;
  } {
    const raw = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
    const rawMilestones = raw.milestones && typeof raw.milestones === 'object' && !Array.isArray(raw.milestones)
      ? (raw.milestones as Record<string, unknown>)
      : {};
    const milestones: MilestoneRanks = {};
    for (const key of MILESTONE_KEYS) {
      const rank = rawMilestones[key];
      if (Number.isInteger(rank) && Number(rank) > 0) milestones[key] = Number(rank);
    }
    return {
      milestones,
      legacyAdjustment: this.parseItemizedStats(raw.legacyAdjustment),
      permanent: this.parseItemizedStats(raw.permanent),
      temporary: this.parseItemizedStats(raw.temporary),
    };
  }

  private parseItemizedStats(value: unknown): ProgressionStatVector {
    const raw = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
    return Object.fromEntries(
      PROGRESSION_STAT_KEYS.map((key) => {
        const candidate = raw[key];
        return [key, typeof candidate === 'number' && Number.isFinite(candidate) ? Math.trunc(candidate) : 0];
      }),
    ) as ProgressionStatVector;
  }
}
