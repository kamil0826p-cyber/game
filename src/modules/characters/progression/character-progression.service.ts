import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CharacterClass } from '../../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../../common/errors/game.error.js';
import { PrismaService } from '../../../database/prisma.service.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import {
  addMilestoneRank,
  calculateCharacterStats,
  calculateLegacyAdjustment,
  CLASS_CURVE_VERSION,
  MILESTONE_DEFINITION_VERSION,
  MILESTONE_DEFINITIONS,
  MILESTONE_KEYS,
  milestonePointsForLevel,
  PROGRESSION_RULES_VERSION,
  PROGRESSION_STAT_KEYS,
  RESOURCE_RECOMPUTE_POLICY,
  RESPEC_COST_VERSION,
  respecCostSilver,
  SOFT_CAPS,
  spentMilestonePoints,
  validateMilestoneRanks,
  ZERO_PROGRESSION_STATS,
  preserveResourceRatio,
  type CharacterStatBreakdown,
  type MilestoneKey,
  type MilestoneRanks,
  type ProgressionStatVector,
} from './character-progression.rules.js';
import type {
  CharacterProgressionSnapshot,
  ProgressionMigrationResult,
  ProgressionMigrationStatus,
} from './character-progression.types.js';

type LoadedCharacter = Prisma.CharacterGetPayload<{
  include: { inventoryItems: { include: { itemDefinition: true } } };
}>;

type ProgressionDatabase = Pick<Prisma.TransactionClient, 'character'>;

export interface CharacterStatCache {
  level: number;
  experience: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
  silver: number;
  stateVersion: number;
}

interface ProgressionBackup {
  version: 1;
  capturedAt: string;
  fields: {
    hp: number;
    maxHp: number;
    energy: number;
    maxEnergy: number;
    strength: number;
    agility: number;
    intelligence: number;
    armor: number;
    progressionVersion: number;
    freeRespecAvailable: boolean;
    progressionMigratedAt: string | null;
  };
}

interface ProgressionAuditEntry {
  at: string;
  action: 'MIGRATE' | 'MILESTONE_ALLOCATE' | 'RESPEC' | 'ROLLBACK';
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

interface ProgressionData {
  milestones: MilestoneRanks;
  legacyAdjustment: ProgressionStatVector;
  permanent: ProgressionStatVector;
  temporary: ProgressionStatVector;
  backup?: ProgressionBackup;
  audit: ProgressionAuditEntry[];
}

interface RecomputeOptions {
  data?: ProgressionData;
  preserveAbsoluteResources?: boolean;
  silver?: number;
  freeRespecAvailable?: boolean;
  progressionVersion?: number;
  progressionMigratedAt?: Date | null;
  appendAudit?: ProgressionAuditEntry;
}

@Injectable()
export class CharacterProgressionService {
  constructor(private readonly prisma: PrismaService) {}

  initialStats(characterClass: CharacterClass): ProgressionStatVector {
    return calculateCharacterStats({ characterClass, level: 1 }).effective;
  }

  initialProgressionData(): Prisma.InputJsonValue {
    return this.toJson(this.emptyProgressionData());
  }

  async ensureCanonical(characterId: string): Promise<CharacterStatCache> {
    return this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      let character = await this.requireLoadedCharacter(transaction, characterId);
      if (character.progressionVersion < PROGRESSION_RULES_VERSION) {
        character = await this.migrateLoadedCharacter(transaction, character, false);
      }
      character = await this.recomputeLoadedCharacter(transaction, character);
      return this.toStatCache(character);
    });
  }

  async recomputeInTransaction(
    transaction: Prisma.TransactionClient,
    characterId: string,
    options: { preserveAbsoluteResources?: boolean } = {},
  ): Promise<CharacterStatCache> {
    await this.lockCharacter(transaction, characterId);
    let character = await this.requireLoadedCharacter(transaction, characterId);
    if (character.progressionVersion < PROGRESSION_RULES_VERSION) {
      character = await this.migrateLoadedCharacter(transaction, character, false);
    }
    character = await this.recomputeLoadedCharacter(transaction, character, {
      preserveAbsoluteResources: options.preserveAbsoluteResources,
    });
    return this.toStatCache(character);
  }

  async getSnapshot(userId: string, characterId: string): Promise<CharacterProgressionSnapshot> {
    await this.ensureCanonical(characterId);
    const character = await this.requireOwnedLoadedCharacter(this.prisma, userId, characterId);
    return this.buildSnapshot(character, this.parseProgressionData(character.progressionData));
  }

  async allocateMilestone(
    userId: string,
    characterId: string,
    milestoneKey: MilestoneKey,
  ): Promise<CharacterProgressionSnapshot> {
    return this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      let character = await this.requireOwnedLoadedCharacter(transaction, userId, characterId);
      if (character.progressionVersion < PROGRESSION_RULES_VERSION) {
        character = await this.migrateLoadedCharacter(transaction, character, false);
      }
      const data = this.parseProgressionData(character.progressionData);
      const before = this.auditState(character, data);
      const milestones = addMilestoneRank(character.level, data.milestones, milestoneKey);
      const nextData: ProgressionData = { ...data, milestones };
      const preview = this.calculateForCharacter(character, nextData);
      const audit: ProgressionAuditEntry = {
        at: new Date().toISOString(),
        action: 'MILESTONE_ALLOCATE',
        before,
        after: {
          milestones,
          effective: preview.effective,
          silver: character.silver,
        },
        metadata: { milestoneKey, definitionVersion: MILESTONE_DEFINITION_VERSION },
      };
      character = await this.recomputeLoadedCharacter(transaction, character, {
        data: nextData,
        appendAudit: audit,
      });
      return this.buildSnapshot(character, this.parseProgressionData(character.progressionData));
    });
  }

  async respec(
    userId: string,
    characterId: string,
    operationId: string,
    milestoneRanks: MilestoneRanks = {},
  ): Promise<CharacterProgressionSnapshot> {
    const normalizedOperationId = operationId.trim();
    if (!normalizedOperationId || normalizedOperationId.length > 64) this.invalidPayload();
    const validation = validateMilestoneRanks(100, milestoneRanks);
    if (!validation.valid) this.invalidPayload({ ...validation });
    const payloadHash = this.payloadHash(milestoneRanks);
    const ledgerOperationId = `progression-respec:${normalizedOperationId}`;

    return this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      let character = await this.requireOwnedLoadedCharacter(transaction, userId, characterId);
      if (character.progressionVersion < PROGRESSION_RULES_VERSION) {
        character = await this.migrateLoadedCharacter(transaction, character, false);
      }

      const existing = await transaction.characterCurrencyLedger.findUnique({
        where: { characterId_operationId: { characterId, operationId: ledgerOperationId } },
      });
      if (existing) {
        const metadata = existing.metadata as { payloadHash?: unknown; snapshot?: unknown };
        if (metadata.payloadHash !== payloadHash || !metadata.snapshot) this.invalidPayload();
        return metadata.snapshot as unknown as CharacterProgressionSnapshot;
      }

      const levelValidation = validateMilestoneRanks(character.level, milestoneRanks);
      if (!levelValidation.valid) this.invalidPayload({ ...levelValidation });
      const data = this.parseProgressionData(character.progressionData);
      const spent = spentMilestonePoints(data.milestones);
      const cost = respecCostSilver(character.level, spent, character.freeRespecAvailable);
      if (character.silver < cost) {
        throw new GameError(
          GAME_ERROR_CODES.INSUFFICIENT_SILVER,
          'errors.items.insufficientSilver',
          { required: cost, available: character.silver },
        );
      }

      const before = this.auditState(character, data);
      const nextData: ProgressionData = { ...data, milestones: { ...milestoneRanks } };
      const preview = this.calculateForCharacter(character, nextData);
      const nextSilver = character.silver - cost;
      const audit: ProgressionAuditEntry = {
        at: new Date().toISOString(),
        action: 'RESPEC',
        before,
        after: {
          milestones: nextData.milestones,
          effective: preview.effective,
          silver: nextSilver,
        },
        metadata: {
          operationId: normalizedOperationId,
          cost,
          respecCostVersion: RESPEC_COST_VERSION,
          payloadHash,
        },
      };
      character = await this.recomputeLoadedCharacter(transaction, character, {
        data: nextData,
        silver: nextSilver,
        freeRespecAvailable: false,
        appendAudit: audit,
      });
      const snapshot = this.buildSnapshot(
        character,
        this.parseProgressionData(character.progressionData),
      );
      await transaction.characterCurrencyLedger.create({
        data: {
          characterId,
          operationId: ledgerOperationId,
          currency: 'SILVER',
          direction: 'DEBIT',
          amount: cost,
          reason: 'CHARACTER_PROGRESSION_RESPEC',
          balanceAfter: nextSilver,
          metadata: this.toJson({
            payloadHash,
            respecCostVersion: RESPEC_COST_VERSION,
            snapshot,
          }),
        },
      });
      return snapshot;
    });
  }

  async migrationStatus(): Promise<ProgressionMigrationStatus> {
    const characters = await this.prisma.character.findMany({
      select: { progressionVersion: true, progressionData: true },
    });
    const migratedCharacters = characters.filter(
      (character) => character.progressionVersion >= PROGRESSION_RULES_VERSION,
    ).length;
    return {
      rulesVersion: PROGRESSION_RULES_VERSION,
      totalCharacters: characters.length,
      migratedCharacters,
      pendingCharacters: characters.length - migratedCharacters,
      rollbackAvailable: characters.filter(
        (character) => Boolean(this.parseProgressionData(character.progressionData).backup),
      ).length,
    };
  }

  async migrateAll(dryRun: boolean): Promise<ProgressionMigrationResult> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('character-progression-migration-v1'))`;
        const characters = await transaction.character.findMany({
          where: { progressionVersion: { lt: PROGRESSION_RULES_VERSION } },
          include: { inventoryItems: { where: { equippedSlot: { not: null } }, include: { itemDefinition: true } } },
          orderBy: { id: 'asc' },
        });
        const changed: string[] = [];
        for (const character of characters) {
          await this.lockCharacter(transaction, character.id);
          if (!dryRun) await this.migrateLoadedCharacter(transaction, character, false);
          changed.push(character.id);
        }
        return {
          dryRun,
          processed: characters.length,
          changed: changed.length,
          characterIds: changed,
        };
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  async rollbackAll(dryRun: boolean): Promise<ProgressionMigrationResult> {
    return this.prisma.$transaction(
      async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('character-progression-migration-v1'))`;
        const characters = await transaction.character.findMany({
          where: { progressionVersion: { gte: PROGRESSION_RULES_VERSION } },
          include: { inventoryItems: { where: { equippedSlot: { not: null } }, include: { itemDefinition: true } } },
          orderBy: { id: 'asc' },
        });
        const changed: string[] = [];
        for (const character of characters) {
          await this.lockCharacter(transaction, character.id);
          const data = this.parseProgressionData(character.progressionData);
          if (!data.backup) continue;
          changed.push(character.id);
          if (dryRun) continue;
          const before = this.auditState(character, data);
          const backup = data.backup;
          const rollbackData: ProgressionData = {
            ...data,
            milestones: {},
            legacyAdjustment: { ...ZERO_PROGRESSION_STATS },
            audit: this.appendAudit(data.audit, {
              at: new Date().toISOString(),
              action: 'ROLLBACK',
              before,
              after: { ...backup.fields },
              metadata: { backupVersion: backup.version },
            }),
          };
          await transaction.character.update({
            where: { id: character.id },
            data: {
              hp: backup.fields.hp,
              maxHp: backup.fields.maxHp,
              energy: backup.fields.energy,
              maxEnergy: backup.fields.maxEnergy,
              strength: backup.fields.strength,
              agility: backup.fields.agility,
              intelligence: backup.fields.intelligence,
              armor: backup.fields.armor,
              progressionVersion: backup.fields.progressionVersion,
              progressionData: this.toJson(rollbackData),
              freeRespecAvailable: backup.fields.freeRespecAvailable,
              progressionMigratedAt: backup.fields.progressionMigratedAt
                ? new Date(backup.fields.progressionMigratedAt)
                : null,
              stateVersion: { increment: 1 },
              lastSavedAt: new Date(),
            },
          });
        }
        return {
          dryRun,
          processed: characters.length,
          changed: changed.length,
          characterIds: changed,
        };
      },
      { maxWait: 10_000, timeout: 120_000 },
    );
  }

  private async migrateLoadedCharacter(
    transaction: Prisma.TransactionClient,
    character: LoadedCharacter,
    dryRun: boolean,
  ): Promise<LoadedCharacter> {
    if (character.progressionVersion >= PROGRESSION_RULES_VERSION) return character;
    const previousData = this.parseProgressionData(character.progressionData);
    const withoutLegacy: ProgressionData = {
      ...previousData,
      milestones: {},
      legacyAdjustment: { ...ZERO_PROGRESSION_STATS },
    };
    const canonical = this.calculateForCharacter(character, withoutLegacy);
    const legacyEffective = this.statsFromCharacter(character);
    const legacyAdjustment = calculateLegacyAdjustment(
      legacyEffective,
      canonical.effective,
    );
    const backup: ProgressionBackup = previousData.backup ?? {
      version: 1,
      capturedAt: new Date().toISOString(),
      fields: {
        hp: character.hp,
        maxHp: character.maxHp,
        energy: character.energy,
        maxEnergy: character.maxEnergy,
        strength: character.strength,
        agility: character.agility,
        intelligence: character.intelligence,
        armor: character.armor,
        progressionVersion: character.progressionVersion,
        freeRespecAvailable: character.freeRespecAvailable,
        progressionMigratedAt: character.progressionMigratedAt?.toISOString() ?? null,
      },
    };
    const nextData: ProgressionData = {
      ...withoutLegacy,
      legacyAdjustment,
      backup,
      audit: this.appendAudit(previousData.audit, {
        at: new Date().toISOString(),
        action: 'MIGRATE',
        before: {
          effective: legacyEffective,
          hp: character.hp,
          energy: character.energy,
          progressionVersion: character.progressionVersion,
        },
        after: {
          effective: legacyEffective,
          legacyAdjustment,
          progressionVersion: PROGRESSION_RULES_VERSION,
        },
        metadata: {
          classCurveVersion: CLASS_CURVE_VERSION,
          milestoneDefinitionVersion: MILESTONE_DEFINITION_VERSION,
        },
      }),
    };
    if (dryRun) return character;
    return this.recomputeLoadedCharacter(transaction, character, {
      data: nextData,
      preserveAbsoluteResources: true,
      progressionVersion: PROGRESSION_RULES_VERSION,
      progressionMigratedAt: new Date(),
      freeRespecAvailable: true,
    });
  }

  private async recomputeLoadedCharacter(
    transaction: Prisma.TransactionClient,
    character: LoadedCharacter,
    options: RecomputeOptions = {},
  ): Promise<LoadedCharacter> {
    const data = options.data ?? this.parseProgressionData(character.progressionData);
    const nextData = options.appendAudit
      ? { ...data, audit: this.appendAudit(data.audit, options.appendAudit) }
      : data;
    const calculated = this.calculateForCharacter(character, nextData);
    const nextHp = options.preserveAbsoluteResources
      ? Math.min(calculated.effective.maxHp, Math.max(0, character.hp))
      : preserveResourceRatio(character.hp, character.maxHp, calculated.effective.maxHp);
    const nextEnergy = options.preserveAbsoluteResources
      ? Math.min(calculated.effective.maxEnergy, Math.max(0, character.energy))
      : preserveResourceRatio(character.energy, character.maxEnergy, calculated.effective.maxEnergy);
    const nextSilver = options.silver ?? character.silver;
    const nextFreeRespec = options.freeRespecAvailable ?? character.freeRespecAvailable;
    const nextVersion = options.progressionVersion ?? character.progressionVersion;
    const nextMigratedAt = options.progressionMigratedAt === undefined
      ? character.progressionMigratedAt
      : options.progressionMigratedAt;
    const dataChanged = JSON.stringify(nextData) !== JSON.stringify(this.parseProgressionData(character.progressionData));
    const changed =
      character.hp !== nextHp ||
      character.maxHp !== calculated.effective.maxHp ||
      character.energy !== nextEnergy ||
      character.maxEnergy !== calculated.effective.maxEnergy ||
      character.strength !== calculated.effective.strength ||
      character.agility !== calculated.effective.agility ||
      character.intelligence !== calculated.effective.intelligence ||
      character.armor !== calculated.effective.armor ||
      character.silver !== nextSilver ||
      character.freeRespecAvailable !== nextFreeRespec ||
      character.progressionVersion !== nextVersion ||
      character.progressionMigratedAt?.getTime() !== nextMigratedAt?.getTime() ||
      dataChanged;
    if (!changed) return character;
    const updated = await transaction.character.update({
      where: { id: character.id },
      data: {
        hp: nextHp,
        maxHp: calculated.effective.maxHp,
        energy: nextEnergy,
        maxEnergy: calculated.effective.maxEnergy,
        strength: calculated.effective.strength,
        agility: calculated.effective.agility,
        intelligence: calculated.effective.intelligence,
        armor: calculated.effective.armor,
        silver: nextSilver,
        progressionVersion: nextVersion,
        progressionData: this.toJson(nextData),
        freeRespecAvailable: nextFreeRespec,
        progressionMigratedAt: nextMigratedAt,
        stateVersion: { increment: 1 },
        lastSavedAt: new Date(),
      },
    });
    return { ...character, ...updated };
  }

  private buildSnapshot(
    character: LoadedCharacter,
    data: ProgressionData,
  ): CharacterProgressionSnapshot {
    const calculated = this.calculateForCharacter(character, data);
    const earned = milestonePointsForLevel(character.level);
    const spent = spentMilestonePoints(data.milestones);
    const milestones = MILESTONE_DEFINITIONS.map((definition) => {
      try {
        const nextRanks = addMilestoneRank(character.level, data.milestones, definition.key);
        const preview = this.calculateForCharacter(character, { ...data, milestones: nextRanks });
        return {
          ...definition,
          currentRank: data.milestones[definition.key] ?? 0,
          canAllocate: true,
          previewEffectiveDelta: this.subtractStats(preview.effective, calculated.effective),
        };
      } catch (error) {
        return {
          ...definition,
          currentRank: data.milestones[definition.key] ?? 0,
          canAllocate: false,
          blockedReason: error instanceof Error ? error.message : 'MILESTONE_INVALID',
          previewEffectiveDelta: { ...ZERO_PROGRESSION_STATS },
        };
      }
    });
    return {
      rulesVersion: PROGRESSION_RULES_VERSION,
      classCurveVersion: CLASS_CURVE_VERSION,
      milestoneDefinitionVersion: MILESTONE_DEFINITION_VERSION,
      respecCostVersion: RESPEC_COST_VERSION,
      resourcePolicy: RESOURCE_RECOMPUTE_POLICY,
      characterClass: character.class,
      level: character.level,
      stateVersion: character.stateVersion,
      current: { hp: character.hp, energy: character.energy, silver: character.silver },
      points: { earned, spent, available: Math.max(0, earned - spent) },
      sources: calculated.sources,
      rawTotal: calculated.rawTotal,
      effective: calculated.effective,
      derived: calculated.derived,
      softCaps: SOFT_CAPS.map((cap) => ({ ...cap })),
      milestones,
      respec: {
        freeAvailable: character.freeRespecAvailable,
        costSilver: respecCostSilver(character.level, spent, character.freeRespecAvailable),
      },
    };
  }

  private calculateForCharacter(
    character: LoadedCharacter,
    data: ProgressionData,
  ): CharacterStatBreakdown {
    return calculateCharacterStats({
      characterClass: character.class,
      level: character.level,
      milestoneRanks: data.milestones,
      equipment: this.equipmentBonuses(character),
      permanent: data.permanent,
      temporary: data.temporary,
      legacyAdjustment: data.legacyAdjustment,
    });
  }

  private equipmentBonuses(character: LoadedCharacter): ProgressionStatVector {
    const result = { ...ZERO_PROGRESSION_STATS };
    for (const item of character.inventoryItems) {
      if (!item.equippedSlot) continue;
      const metadata = item.itemDefinition.metadata as {
        statBonuses?: Partial<Record<string, unknown>>;
      };
      for (const key of PROGRESSION_STAT_KEYS) {
        const value = metadata.statBonuses?.[key];
        if (typeof value === 'number' && Number.isFinite(value)) result[key] += Math.round(value);
      }
    }
    return result;
  }

  private async requireLoadedCharacter(
    database: ProgressionDatabase,
    characterId: string,
  ): Promise<LoadedCharacter> {
    const character = await database.character.findUnique({
      where: { id: characterId },
      include: {
        inventoryItems: {
          where: { equippedSlot: { not: null } },
          include: { itemDefinition: true },
        },
      },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    return character;
  }

  private async requireOwnedLoadedCharacter(
    database: ProgressionDatabase,
    userId: string,
    characterId: string,
  ): Promise<LoadedCharacter> {
    const character = await database.character.findFirst({
      where: { id: characterId, userId },
      include: {
        inventoryItems: {
          where: { equippedSlot: { not: null } },
          include: { itemDefinition: true },
        },
      },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    return character;
  }

  private async lockCharacter(
    transaction: Prisma.TransactionClient,
    characterId: string,
  ): Promise<void> {
    const lockKey = `character-progression:${characterId}`;
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }

  private parseProgressionData(value: Prisma.JsonValue): ProgressionData {
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
    const audit = Array.isArray(raw.audit)
      ? raw.audit.filter((entry): entry is ProgressionAuditEntry => Boolean(entry && typeof entry === 'object')).slice(-50)
      : [];
    const backup = raw.backup && typeof raw.backup === 'object' && !Array.isArray(raw.backup)
      ? (raw.backup as unknown as ProgressionBackup)
      : undefined;
    return {
      milestones,
      legacyAdjustment: this.parseStats(raw.legacyAdjustment),
      permanent: this.parseStats(raw.permanent),
      temporary: this.parseStats(raw.temporary),
      backup,
      audit,
    };
  }

  private emptyProgressionData(): ProgressionData {
    return {
      milestones: {},
      legacyAdjustment: { ...ZERO_PROGRESSION_STATS },
      permanent: { ...ZERO_PROGRESSION_STATS },
      temporary: { ...ZERO_PROGRESSION_STATS },
      audit: [],
    };
  }

  private parseStats(value: unknown): ProgressionStatVector {
    const raw = value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
    return Object.fromEntries(
      PROGRESSION_STAT_KEYS.map((key) => {
        const candidate = raw[key];
        return [key, typeof candidate === 'number' && Number.isFinite(candidate) ? Math.round(candidate) : 0];
      }),
    ) as ProgressionStatVector;
  }

  private appendAudit(
    entries: readonly ProgressionAuditEntry[],
    entry: ProgressionAuditEntry,
  ): ProgressionAuditEntry[] {
    return [...entries.slice(-49), entry];
  }

  private auditState(character: LoadedCharacter, data: ProgressionData): Record<string, unknown> {
    return {
      level: character.level,
      milestones: { ...data.milestones },
      effective: this.statsFromCharacter(character),
      hp: character.hp,
      energy: character.energy,
      silver: character.silver,
      stateVersion: character.stateVersion,
    };
  }

  private statsFromCharacter(character: LoadedCharacter): ProgressionStatVector {
    return {
      maxHp: character.maxHp,
      maxEnergy: character.maxEnergy,
      strength: character.strength,
      agility: character.agility,
      intelligence: character.intelligence,
      armor: character.armor,
    };
  }

  private toStatCache(character: LoadedCharacter): CharacterStatCache {
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

  private subtractStats(
    left: ProgressionStatVector,
    right: ProgressionStatVector,
  ): ProgressionStatVector {
    return Object.fromEntries(
      PROGRESSION_STAT_KEYS.map((key) => [key, left[key] - right[key]]),
    ) as ProgressionStatVector;
  }

  private payloadHash(ranks: MilestoneRanks): string {
    const normalized = Object.fromEntries(
      MILESTONE_KEYS.map((key) => [key, ranks[key] ?? 0]),
    );
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private invalidPayload(details?: Record<string, unknown>): never {
    throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', details);
  }
}
