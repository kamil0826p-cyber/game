import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CharacterClass } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { skillsForClass } from './skill.catalog.js';
import {
  findSkillBuildNode,
  skillBuildNodesForClass,
  skillSpecializationsForClass,
} from './skill.buildcraft.catalog.js';
import {
  calculateBuildPoints,
  createInitialBuildData,
  normalizeBuildData,
  passiveBudgetSpent,
  payloadHash,
  rankMapFromLearned,
  resolveSkillDefinition,
  revalidateLoadouts,
  skillRespecCostSilver,
  spentBuildPoints,
  validateCompleteBuild,
  validateLoadout,
  validateRankUp,
  validateSpecializationSelection,
  type LearnedSkillState,
} from './skill.buildcraft.rules.js';
import {
  SKILL_BUILD_MAX_ACTIVE_ACTIONS,
  SKILL_BUILD_MAX_LOADOUTS,
  SKILL_BUILD_MAX_PASSIVE_SLOTS,
  SKILL_BUILD_PASSIVE_BUDGET,
  SKILL_BUILD_RULES_VERSION,
  type SkillBuildAuditEntry,
  type SkillBuildPersistenceData,
  type SkillBuildSnapshot,
  type SkillBuildSkillPayload,
  type SkillCombatLoadout,
  type SkillFallbackAction,
  type SkillLoadoutDefinition,
  type SkillBuildOperationRecord,
} from './skill.buildcraft.types.js';
import type { SkillUnlockState } from './skill.types.js';

type SkillDatabase = Pick<
  Prisma.TransactionClient,
  | 'character'
  | 'characterSkill'
  | 'skillDefinition'
  | 'tradeSession'
  | 'characterCurrencyLedger'
  | '$queryRaw'
  | '$executeRaw'
>;

interface BuildStateRow {
  characterId: string;
  version: number;
  data: unknown;
}

interface LoadedCharacter {
  id: string;
  userId: string;
  class: CharacterClass;
  level: number;
  combatState: 'IDLE' | 'IN_BATTLE';
  silver: number;
  skills: Array<{
    skillDefinitionId: string;
    rank: number;
    cooldownTurnsRemaining: number;
    skillDefinition: {
      key: string;
      displayOrder: number;
    };
  }>;
}

export interface SkillLoadoutMutationInput {
  operationId: string;
  expectedVersion: number;
  loadoutId?: string;
  name: string;
  activeSkillKeys: string[];
  passiveNodeKeys: string[];
  fallbackAction: SkillFallbackAction;
}

export interface SkillRespecInput {
  operationId: string;
  expectedVersion: number;
  selectedSpecializationKey?: string;
  ranks: Record<string, number>;
}

export interface SkillRespecPreview {
  valid: boolean;
  reasons: string[];
  costSilver: number;
  points: ReturnType<typeof calculateBuildPoints>;
  invalidLoadoutIds: string[];
}

@Injectable()
export class SkillService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(userId: string, characterId: string): Promise<SkillBuildSnapshot> {
    return this.prisma.$transaction(async (transaction) => {
      const character = await this.requireOwnedCharacter(transaction, userId, characterId);
      const learned = this.learnedSkills(character);
      const state = await this.ensureBuildState(transaction, character.id, learned);
      return this.buildSnapshot(character, state.version, state.data);
    });
  }

  async unlock(
    userId: string,
    characterId: string,
    nodeKey: string,
  ): Promise<SkillBuildSnapshot> {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const character = await this.requireOwnedCharacter(transaction, userId, characterId);
      const learned = this.learnedSkills(character);
      const state = await this.ensureBuildState(transaction, character.id, learned);
      await this.assertBuildChangeAllowed(transaction, character);
      const ranks = rankMapFromLearned(learned, state.data.nodeRanks);
      const validation = validateRankUp({
        characterClass: character.class,
        characterLevel: character.level,
        selectedSpecializationKey: state.data.selectedSpecializationKey,
        ranks,
        nodeKey,
      });
      if (!validation.valid) this.invalid({ reasons: validation.reasons });
      const node = findSkillBuildNode(nodeKey)!;
      const beforeVersion = state.version;
      if (node.kind === 'ACTIVE') {
        const definition = await transaction.skillDefinition.findUnique({
          where: { key: node.key },
          select: { id: true, requiredClass: true },
        });
        if (!definition || definition.requiredClass !== character.class) {
          throw new GameError(
            GAME_ERROR_CODES.SKILL_NOT_AVAILABLE,
            'errors.skills.notAvailable',
          );
        }
        const existing = character.skills.find(
          (entry) => entry.skillDefinition.key === node.key,
        );
        if (existing) {
          await transaction.characterSkill.update({
            where: { characterId_skillDefinitionId: { characterId, skillDefinitionId: definition.id } },
            data: { rank: existing.rank + 1 },
          });
        } else {
          await transaction.characterSkill.create({
            data: {
              characterId,
              skillDefinitionId: definition.id,
              rank: 1,
              cooldownTurnsRemaining: 0,
            },
          });
        }
      } else {
        state.data.nodeRanks[node.key] = (state.data.nodeRanks[node.key] ?? 0) + 1;
      }
      const nextRanks = { ...ranks, [node.key]: (ranks[node.key] ?? 0) + 1 };
      state.data.loadouts = revalidateLoadouts({
        characterClass: character.class,
        selectedSpecializationKey: state.data.selectedSpecializationKey,
        ranks: nextRanks,
        loadouts: state.data.loadouts,
      });
      state.data.audit = this.appendAudit(state.data.audit, {
        at: new Date().toISOString(),
        action: 'RANK_UP',
        beforeVersion,
        afterVersion: beforeVersion + 1,
        metadata: { nodeKey, rank: nextRanks[node.key] },
      });
      await this.persistBuildState(
        transaction,
        characterId,
        beforeVersion,
        state.data,
      );
    });
    return this.getSnapshot(userId, characterId);
  }

  async chooseSpecialization(
    userId: string,
    characterId: string,
    input: {
      operationId: string;
      expectedVersion: number;
      specializationKey: string;
    },
  ): Promise<SkillBuildSnapshot> {
    const operationId = this.normalizeOperationId(input.operationId);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const character = await this.requireOwnedCharacter(transaction, userId, characterId);
      const learned = this.learnedSkills(character);
      const state = await this.ensureBuildState(transaction, characterId, learned);
      const hash = payloadHash({ specializationKey: input.specializationKey });
      if (this.isRepeatedOperation(state.data, operationId, 'SPECIALIZATION_SELECT', hash)) {
        return;
      }
      this.assertVersion(state.version, input.expectedVersion);
      await this.assertBuildChangeAllowed(transaction, character);
      const ranks = rankMapFromLearned(learned, state.data.nodeRanks);
      const validation = validateSpecializationSelection({
        characterClass: character.class,
        specializationKey: input.specializationKey,
        ranks,
      });
      if (!validation.valid) this.invalid({ reasons: validation.reasons });
      const beforeVersion = state.version;
      state.data.selectedSpecializationKey = input.specializationKey;
      state.data.loadouts = revalidateLoadouts({
        characterClass: character.class,
        selectedSpecializationKey: input.specializationKey,
        ranks,
        loadouts: state.data.loadouts,
      });
      this.recordOperation(
        state.data,
        operationId,
        'SPECIALIZATION_SELECT',
        hash,
        beforeVersion + 1,
      );
      state.data.audit = this.appendAudit(state.data.audit, {
        at: new Date().toISOString(),
        action: 'SPECIALIZATION_SELECT',
        operationId,
        beforeVersion,
        afterVersion: beforeVersion + 1,
        metadata: { specializationKey: input.specializationKey },
      });
      await this.persistBuildState(transaction, characterId, beforeVersion, state.data);
    });
    return this.getSnapshot(userId, characterId);
  }

  async saveLoadout(
    userId: string,
    characterId: string,
    input: SkillLoadoutMutationInput,
  ): Promise<SkillBuildSnapshot> {
    const operationId = this.normalizeOperationId(input.operationId);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const character = await this.requireOwnedCharacter(transaction, userId, characterId);
      const learned = this.learnedSkills(character);
      const state = await this.ensureBuildState(transaction, characterId, learned);
      const normalized = {
        loadoutId: input.loadoutId?.trim() || undefined,
        name: input.name.trim().slice(0, 32),
        activeSkillKeys: [...input.activeSkillKeys],
        passiveNodeKeys: [...input.passiveNodeKeys],
        fallbackAction: input.fallbackAction,
      };
      if (!normalized.name) this.invalid({ reason: 'LOADOUT_NAME_REQUIRED' });
      const hash = payloadHash(normalized);
      if (this.isRepeatedOperation(state.data, operationId, 'LOADOUT_SAVE', hash)) return;
      this.assertVersion(state.version, input.expectedVersion);
      await this.assertBuildChangeAllowed(transaction, character);
      const ranks = rankMapFromLearned(learned, state.data.nodeRanks);
      const invalidReasons = validateLoadout({
        characterClass: character.class,
        selectedSpecializationKey: state.data.selectedSpecializationKey,
        ranks,
        activeSkillKeys: normalized.activeSkillKeys,
        passiveNodeKeys: normalized.passiveNodeKeys,
      });
      if (invalidReasons.length > 0) this.invalid({ invalidReasons });
      const existingIndex = normalized.loadoutId
        ? state.data.loadouts.findIndex((loadout) => loadout.id === normalized.loadoutId)
        : -1;
      if (existingIndex < 0 && state.data.loadouts.length >= SKILL_BUILD_MAX_LOADOUTS) {
        this.invalid({ reason: 'LOADOUT_LIMIT', limit: SKILL_BUILD_MAX_LOADOUTS });
      }
      const now = new Date().toISOString();
      const previous = existingIndex >= 0 ? state.data.loadouts[existingIndex] : undefined;
      const loadout: SkillLoadoutDefinition = {
        id: previous?.id ?? randomUUID(),
        name: normalized.name,
        activeSkillKeys: normalized.activeSkillKeys,
        passiveNodeKeys: normalized.passiveNodeKeys,
        fallbackAction: normalized.fallbackAction,
        version: (previous?.version ?? 0) + 1,
        isValid: true,
        invalidReasons: [],
        updatedAt: now,
      };
      if (existingIndex >= 0) state.data.loadouts[existingIndex] = loadout;
      else state.data.loadouts.push(loadout);
      if (!state.data.activeLoadoutId) state.data.activeLoadoutId = loadout.id;
      const beforeVersion = state.version;
      this.recordOperation(
        state.data,
        operationId,
        'LOADOUT_SAVE',
        hash,
        beforeVersion + 1,
      );
      state.data.audit = this.appendAudit(state.data.audit, {
        at: now,
        action: 'LOADOUT_SAVE',
        operationId,
        beforeVersion,
        afterVersion: beforeVersion + 1,
        metadata: {
          loadoutId: loadout.id,
          activeActions: loadout.activeSkillKeys.length,
          passives: loadout.passiveNodeKeys.length,
        },
      });
      await this.persistBuildState(transaction, characterId, beforeVersion, state.data);
    });
    return this.getSnapshot(userId, characterId);
  }

  async activateLoadout(
    userId: string,
    characterId: string,
    input: { operationId: string; expectedVersion: number; loadoutId: string },
  ): Promise<SkillBuildSnapshot> {
    const operationId = this.normalizeOperationId(input.operationId);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const character = await this.requireOwnedCharacter(transaction, userId, characterId);
      const learned = this.learnedSkills(character);
      const state = await this.ensureBuildState(transaction, characterId, learned);
      const hash = payloadHash({ loadoutId: input.loadoutId });
      if (this.isRepeatedOperation(state.data, operationId, 'LOADOUT_ACTIVATE', hash)) return;
      this.assertVersion(state.version, input.expectedVersion);
      await this.assertBuildChangeAllowed(transaction, character);
      const ranks = rankMapFromLearned(learned, state.data.nodeRanks);
      state.data.loadouts = revalidateLoadouts({
        characterClass: character.class,
        selectedSpecializationKey: state.data.selectedSpecializationKey,
        ranks,
        loadouts: state.data.loadouts,
      });
      const loadout = state.data.loadouts.find((candidate) => candidate.id === input.loadoutId);
      if (!loadout) this.invalid({ reason: 'LOADOUT_NOT_FOUND' });
      if (!loadout.isValid) this.invalid({ invalidReasons: loadout.invalidReasons });
      const beforeVersion = state.version;
      state.data.activeLoadoutId = loadout.id;
      this.recordOperation(
        state.data,
        operationId,
        'LOADOUT_ACTIVATE',
        hash,
        beforeVersion + 1,
      );
      state.data.audit = this.appendAudit(state.data.audit, {
        at: new Date().toISOString(),
        action: 'LOADOUT_ACTIVATE',
        operationId,
        beforeVersion,
        afterVersion: beforeVersion + 1,
        metadata: { loadoutId: loadout.id },
      });
      await this.persistBuildState(transaction, characterId, beforeVersion, state.data);
    });
    return this.getSnapshot(userId, characterId);
  }

  async previewRespec(
    userId: string,
    characterId: string,
    input: Omit<SkillRespecInput, 'operationId' | 'expectedVersion'>,
  ): Promise<SkillRespecPreview> {
    return this.prisma.$transaction(async (transaction) => {
      const character = await this.requireOwnedCharacter(transaction, userId, characterId);
      const learned = this.learnedSkills(character);
      const state = await this.ensureBuildState(transaction, characterId, learned);
      const validation = validateCompleteBuild({
        characterClass: character.class,
        characterLevel: character.level,
        selectedSpecializationKey: input.selectedSpecializationKey,
        ranks: input.ranks,
      });
      const spent = spentBuildPoints(character.class, input.ranks);
      const loadouts = revalidateLoadouts({
        characterClass: character.class,
        selectedSpecializationKey: input.selectedSpecializationKey,
        ranks: input.ranks,
        loadouts: state.data.loadouts,
      });
      return {
        valid: validation.valid,
        reasons: validation.reasons,
        costSilver: skillRespecCostSilver(
          character.level,
          spentBuildPoints(
            character.class,
            rankMapFromLearned(learned, state.data.nodeRanks),
          ),
          state.data.freeRespecAvailable,
        ),
        points: calculateBuildPoints(character.level, spent),
        invalidLoadoutIds: loadouts.filter((loadout) => !loadout.isValid).map((loadout) => loadout.id),
      };
    });
  }

  async respec(
    userId: string,
    characterId: string,
    input: SkillRespecInput,
  ): Promise<SkillBuildSnapshot> {
    const operationId = this.normalizeOperationId(input.operationId);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const character = await this.requireOwnedCharacter(transaction, userId, characterId);
      const learned = this.learnedSkills(character);
      const state = await this.ensureBuildState(transaction, characterId, learned);
      const normalizedRanks = Object.fromEntries(
        Object.entries(input.ranks).map(([key, rank]) => [key, Math.trunc(rank)]),
      );
      const payload = {
        selectedSpecializationKey: input.selectedSpecializationKey,
        ranks: normalizedRanks,
      };
      const hash = payloadHash(payload);
      if (this.isRepeatedOperation(state.data, operationId, 'RESPEC', hash)) return;
      this.assertVersion(state.version, input.expectedVersion);
      await this.assertBuildChangeAllowed(transaction, character);
      const validation = validateCompleteBuild({
        characterClass: character.class,
        characterLevel: character.level,
        selectedSpecializationKey: input.selectedSpecializationKey,
        ranks: normalizedRanks,
      });
      if (!validation.valid) this.invalid({ reasons: validation.reasons });
      const currentRanks = rankMapFromLearned(learned, state.data.nodeRanks);
      const currentSpent = spentBuildPoints(character.class, currentRanks);
      const cost = skillRespecCostSilver(
        character.level,
        currentSpent,
        state.data.freeRespecAvailable,
      );
      if (character.silver < cost) {
        throw new GameError(
          GAME_ERROR_CODES.INSUFFICIENT_SILVER,
          'errors.items.insufficientSilver',
          { required: cost, available: character.silver },
        );
      }
      const activeNodes = skillBuildNodesForClass(character.class).filter(
        (node) => node.kind === 'ACTIVE',
      );
      const retainedKeys = activeNodes
        .filter((node) => (normalizedRanks[node.key] ?? 0) > 0)
        .map((node) => node.key);
      if (retainedKeys.length === 0) {
        await transaction.characterSkill.deleteMany({ where: { characterId } });
      } else {
        await transaction.characterSkill.deleteMany({
          where: {
            characterId,
            skillDefinition: { key: { notIn: retainedKeys } },
          },
        });
      }
      const definitions = await transaction.skillDefinition.findMany({
        where: { key: { in: retainedKeys }, requiredClass: character.class },
        select: { id: true, key: true },
      });
      if (definitions.length !== retainedKeys.length) {
        this.invalid({ reason: 'PERSISTED_SKILL_DEFINITION_MISSING' });
      }
      const existingByKey = new Map(
        character.skills.map((entry) => [entry.skillDefinition.key, entry]),
      );
      for (const definition of definitions) {
        const rank = normalizedRanks[definition.key] ?? 0;
        const existing = existingByKey.get(definition.key);
        if (existing) {
          await transaction.characterSkill.update({
            where: {
              characterId_skillDefinitionId: {
                characterId,
                skillDefinitionId: definition.id,
              },
            },
            data: { rank },
          });
        } else {
          await transaction.characterSkill.create({
            data: {
              characterId,
              skillDefinitionId: definition.id,
              rank,
              cooldownTurnsRemaining: 0,
            },
          });
        }
      }
      state.data.nodeRanks = Object.fromEntries(
        skillBuildNodesForClass(character.class)
          .filter((node) => node.kind !== 'ACTIVE' && (normalizedRanks[node.key] ?? 0) > 0)
          .map((node) => [node.key, normalizedRanks[node.key]!]),
      );
      state.data.selectedSpecializationKey = input.selectedSpecializationKey;
      state.data.loadouts = revalidateLoadouts({
        characterClass: character.class,
        selectedSpecializationKey: input.selectedSpecializationKey,
        ranks: normalizedRanks,
        loadouts: state.data.loadouts,
      });
      state.data.freeRespecAvailable = false;
      const beforeVersion = state.version;
      this.recordOperation(state.data, operationId, 'RESPEC', hash, beforeVersion + 1);
      state.data.audit = this.appendAudit(state.data.audit, {
        at: new Date().toISOString(),
        action: 'RESPEC',
        operationId,
        beforeVersion,
        afterVersion: beforeVersion + 1,
        metadata: {
          cost,
          previousSpent: currentSpent,
          nextSpent: spentBuildPoints(character.class, normalizedRanks),
          invalidLoadoutIds: state.data.loadouts
            .filter((loadout) => !loadout.isValid)
            .map((loadout) => loadout.id),
        },
      });
      if (cost > 0) {
        const nextSilver = character.silver - cost;
        await transaction.character.update({
          where: { id: characterId },
          data: { silver: nextSilver },
        });
        await transaction.characterCurrencyLedger.create({
          data: {
            characterId,
            operationId: `skill-respec:${operationId}`,
            currency: 'SILVER',
            direction: 'DEBIT',
            amount: cost,
            reason: 'SKILL_BUILD_RESPEC',
            balanceAfter: nextSilver,
            metadata: { payloadHash: hash, rulesVersion: SKILL_BUILD_RULES_VERSION },
          },
        });
      }
      await this.persistBuildState(transaction, characterId, beforeVersion, state.data);
    });
    return this.getSnapshot(userId, characterId);
  }

  async getCombatLoadout(
    userId: string,
    characterId: string,
  ): Promise<SkillCombatLoadout> {
    return this.prisma.$transaction(async (transaction) => {
      const character = await this.requireOwnedCharacter(transaction, userId, characterId);
      const learned = this.learnedSkills(character);
      const state = await this.ensureBuildState(transaction, characterId, learned);
      const ranks = rankMapFromLearned(learned, state.data.nodeRanks);
      const loadouts = revalidateLoadouts({
        characterClass: character.class,
        selectedSpecializationKey: state.data.selectedSpecializationKey,
        ranks,
        loadouts: state.data.loadouts,
      });
      const loadout = loadouts.find(
        (candidate) => candidate.id === state.data.activeLoadoutId && candidate.isValid,
      );
      if (!loadout) {
        return {
          definitions: [],
          fallbackAction: 'DEFEND',
          buildVersion: state.version,
        };
      }
      const learnedByKey = new Map(learned.map((entry) => [entry.skillKey, entry]));
      const definitions = loadout.activeSkillKeys.flatMap((skillKey) => {
        const learnedSkill = learnedByKey.get(skillKey);
        if (!learnedSkill) return [];
        const definition = resolveSkillDefinition({
          skillKey,
          activeRank: learnedSkill.rank,
          passiveNodeKeys: loadout.passiveNodeKeys,
          ranks,
        });
        return definition
          ? [{ definition, cooldownTurnsRemaining: learnedSkill.cooldownTurnsRemaining }]
          : [];
      });
      return {
        definitions,
        fallbackAction: loadout.fallbackAction,
        buildVersion: state.version,
        loadoutId: loadout.id,
      };
    });
  }

  async persistCooldowns(
    characterId: string,
    cooldowns: Readonly<Record<string, number>>,
  ): Promise<void> {
    const entries = Object.entries(cooldowns);
    if (entries.length === 0) return;
    await this.prisma.$transaction(
      entries.map(([key, cooldownTurnsRemaining]) =>
        this.prisma.characterSkill.updateMany({
          where: { characterId, skillDefinition: { key } },
          data: { cooldownTurnsRemaining: Math.max(0, Math.trunc(cooldownTurnsRemaining)) },
        }),
      ),
    );
  }

  private async requireOwnedCharacter(
    database: SkillDatabase,
    userId: string,
    characterId: string,
  ): Promise<LoadedCharacter> {
    const character = await database.character.findFirst({
      where: { id: characterId, userId },
      select: {
        id: true,
        userId: true,
        class: true,
        level: true,
        combatState: true,
        silver: true,
        skills: {
          select: {
            skillDefinitionId: true,
            rank: true,
            cooldownTurnsRemaining: true,
            skillDefinition: { select: { key: true, displayOrder: true } },
          },
        },
      },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    return {
      ...character,
      class: character.class as CharacterClass,
      skills: [...character.skills].sort(
        (first, second) => first.skillDefinition.displayOrder - second.skillDefinition.displayOrder,
      ),
    };
  }

  private learnedSkills(character: LoadedCharacter): LearnedSkillState[] {
    return character.skills.map((entry) => ({
      skillKey: entry.skillDefinition.key,
      rank: Math.max(1, entry.rank),
      cooldownTurnsRemaining: Math.max(0, entry.cooldownTurnsRemaining),
    }));
  }

  private async ensureBuildState(
    database: SkillDatabase,
    characterId: string,
    learned: readonly LearnedSkillState[],
  ): Promise<{ version: number; data: SkillBuildPersistenceData }> {
    const rows = await database.$queryRaw<BuildStateRow[]>`
      SELECT "characterId", "version", "data"
      FROM "CharacterSkillBuildState"
      WHERE "characterId" = ${characterId}::uuid
    `;
    if (rows[0]) {
      return {
        version: rows[0].version,
        data: normalizeBuildData(rows[0].data, learned, new Date().toISOString()),
      };
    }
    const now = new Date().toISOString();
    const data = createInitialBuildData(learned, now);
    const json = JSON.stringify(data);
    await database.$executeRaw`
      INSERT INTO "CharacterSkillBuildState" (
        "characterId", "version", "data", "createdAt", "updatedAt"
      ) VALUES (
        ${characterId}::uuid, 1, ${json}::jsonb, NOW(), NOW()
      )
      ON CONFLICT ("characterId") DO NOTHING
    `;
    const created = await database.$queryRaw<BuildStateRow[]>`
      SELECT "characterId", "version", "data"
      FROM "CharacterSkillBuildState"
      WHERE "characterId" = ${characterId}::uuid
    `;
    if (!created[0]) throw new Error('SKILL_BUILD_STATE_NOT_CREATED');
    return {
      version: created[0].version,
      data: normalizeBuildData(created[0].data, learned, now),
    };
  }

  private async persistBuildState(
    database: SkillDatabase,
    characterId: string,
    expectedVersion: number,
    data: SkillBuildPersistenceData,
  ): Promise<void> {
    const json = JSON.stringify(data);
    const updated = await database.$executeRaw`
      UPDATE "CharacterSkillBuildState"
      SET "version" = ${expectedVersion + 1},
          "data" = ${json}::jsonb,
          "updatedAt" = NOW()
      WHERE "characterId" = ${characterId}::uuid
        AND "version" = ${expectedVersion}
    `;
    if (updated !== 1) this.invalid({ reason: 'BUILD_VERSION_CONFLICT' });
  }

  private buildSnapshot(
    character: LoadedCharacter,
    version: number,
    rawData: SkillBuildPersistenceData,
  ): SkillBuildSnapshot {
    const learned = this.learnedSkills(character);
    const ranks = rankMapFromLearned(learned, rawData.nodeRanks);
    const learnedByKey = new Map(learned.map((entry) => [entry.skillKey, entry]));
    const loadouts = revalidateLoadouts({
      characterClass: character.class,
      selectedSpecializationKey: rawData.selectedSpecializationKey,
      ranks,
      loadouts: rawData.loadouts,
    });
    const activeLoadout = loadouts.find(
      (loadout) => loadout.id === rawData.activeLoadoutId,
    );
    const passiveKeys = activeLoadout?.isValid ? activeLoadout.passiveNodeKeys : [];
    const spent = spentBuildPoints(character.class, ranks);
    const points = calculateBuildPoints(character.level, spent);
    const skills: SkillBuildSkillPayload[] = skillsForClass(character.class).map((base) => {
      const learnedSkill = learnedByKey.get(base.key);
      const node = findSkillBuildNode(base.key)!;
      const validation = validateRankUp({
        characterClass: character.class,
        characterLevel: character.level,
        selectedSpecializationKey: rawData.selectedSpecializationKey,
        ranks,
        nodeKey: base.key,
      });
      const effective = resolveSkillDefinition({
        skillKey: base.key,
        activeRank: learnedSkill?.rank ?? 1,
        passiveNodeKeys: passiveKeys,
        ranks,
      }) ?? base;
      const currentRank = learnedSkill?.rank ?? 0;
      const unlockState = this.unlockState(currentRank, node.maxRank, validation.reasons);
      return {
        key: base.key,
        name: base.name,
        description: base.description,
        characterClass: base.characterClass,
        minimumLevel: base.minimumLevel,
        energyCost: effective.energyCost,
        cooldownTurns: effective.cooldownTurns,
        targeting: effective.targeting,
        maxRank: node.maxRank,
        displayOrder: base.displayOrder,
        treeRow: base.treeRow,
        treeColumn: base.treeColumn,
        icon: base.icon,
        prerequisiteKeys: [...base.prerequisiteKeys],
        effects: [...effective.effects],
        animationKey: effective.animationKey,
        visual: { ...effective.visual },
        baseImpact: {
          energyCost: base.energyCost,
          cooldownTurns: base.cooldownTurns,
          targeting: base.targeting,
        },
        rank: currentRank,
        cooldownTurnsRemaining: learnedSkill?.cooldownTurnsRemaining ?? 0,
        unlockState,
        missingPrerequisiteKeys: validation.reasons
          .filter((reason) => reason.startsWith('PREREQUISITE:'))
          .flatMap((reason) => reason.slice('PREREQUISITE:'.length).split(',')),
      };
    });
    const nodes = skillBuildNodesForClass(character.class).map((node) => {
      const validation = validateRankUp({
        characterClass: character.class,
        characterLevel: character.level,
        selectedSpecializationKey: rawData.selectedSpecializationKey,
        ranks,
        nodeKey: node.key,
      });
      return {
        ...node,
        prerequisiteKeys: [...node.prerequisiteKeys],
        prerequisiteAnyOf: node.prerequisiteAnyOf?.map((group) => [...group]),
        modifiersByRank: node.modifiersByRank?.map((operations) =>
          operations.map((operation) => ({ ...operation })),
        ),
        rank: ranks[node.key] ?? 0,
        available: validation.valid,
        blockedReasons: validation.reasons,
      };
    });
    const specializations = skillSpecializationsForClass(character.class).map(
      (specialization) => ({
        ...specialization,
        groupSynergies: [...specialization.groupSynergies] as [string, string, ...string[]],
        selected: specialization.key === rawData.selectedSpecializationKey,
        spentPoints: skillBuildNodesForClass(character.class)
          .filter((node) => node.specializationKey === specialization.key)
          .reduce(
            (sum, node) => sum + (ranks[node.key] ?? 0) * node.pointCost,
            0,
          ),
      }),
    );
    return {
      characterClass: character.class,
      characterLevel: character.level,
      rulesVersion: SKILL_BUILD_RULES_VERSION,
      version,
      points,
      skills,
      nodes,
      specializations,
      selectedSpecializationKey: rawData.selectedSpecializationKey,
      loadouts,
      activeLoadoutId: rawData.activeLoadoutId,
      activeLoadout,
      activeActionLimit: SKILL_BUILD_MAX_ACTIVE_ACTIONS,
      passiveSlotLimit: SKILL_BUILD_MAX_PASSIVE_SLOTS,
      passiveBudget: SKILL_BUILD_PASSIVE_BUDGET,
      freeRespecAvailable: rawData.freeRespecAvailable,
      respecCostSilver: skillRespecCostSilver(
        character.level,
        spent,
        rawData.freeRespecAvailable,
      ),
    };
  }

  private unlockState(
    rank: number,
    maxRank: number,
    reasons: readonly string[],
  ): SkillUnlockState {
    if (rank >= maxRank) return 'UNLOCKED';
    if (reasons.length === 0) return 'AVAILABLE';
    if (reasons.some((reason) => reason === 'LEVEL_REQUIRED')) return 'LOCKED_LEVEL';
    if (reasons.some((reason) => reason.startsWith('PREREQUISITE'))) {
      return 'LOCKED_PREREQUISITE';
    }
    return 'LOCKED_POINTS';
  }

  private async assertBuildChangeAllowed(
    transaction: Prisma.TransactionClient,
    character: LoadedCharacter,
  ): Promise<void> {
    if (character.combatState !== 'IDLE') {
      throw new GameError(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
    }
    const activeTrades = await transaction.tradeSession.count({
      where: {
        OR: [
          { initiatorCharacterId: character.id },
          { recipientCharacterId: character.id },
        ],
        status: { in: ['REQUESTED', 'OPEN', 'LOCKED'] },
      },
    });
    if (activeTrades > 0) {
      throw new GameError(GAME_ERROR_CODES.TRADE_BUSY, 'errors.trade.busy');
    }
  }

  private async lockCharacter(
    transaction: Prisma.TransactionClient,
    characterId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Character"
      WHERE "id" = ${characterId}::uuid
      FOR UPDATE
    `;
  }

  private normalizeOperationId(operationId: string): string {
    const normalized = operationId.trim();
    if (!normalized || normalized.length > 64) this.invalid({ reason: 'OPERATION_ID_INVALID' });
    return normalized;
  }

  private assertVersion(actual: number, expected: number): void {
    if (!Number.isInteger(expected) || actual !== expected) {
      this.invalid({ reason: 'BUILD_VERSION_CONFLICT', expected, actual });
    }
  }

  private isRepeatedOperation(
    data: SkillBuildPersistenceData,
    operationId: string,
    kind: SkillBuildOperationRecord['kind'],
    hash: string,
  ): boolean {
    const existing = data.operations[operationId];
    if (!existing) return false;
    if (existing.kind !== kind || existing.payloadHash !== hash) {
      this.invalid({ reason: 'OPERATION_ID_REUSED' });
    }
    return true;
  }

  private recordOperation(
    data: SkillBuildPersistenceData,
    operationId: string,
    kind: SkillBuildOperationRecord['kind'],
    hash: string,
    resultingVersion: number,
  ): void {
    data.operations[operationId] = {
      kind,
      payloadHash: hash,
      resultingVersion,
    };
    const operationIds = Object.keys(data.operations);
    for (const stale of operationIds.slice(0, Math.max(0, operationIds.length - 100))) {
      delete data.operations[stale];
    }
  }

  private appendAudit(
    audit: SkillBuildAuditEntry[],
    entry: SkillBuildAuditEntry,
  ): SkillBuildAuditEntry[] {
    return [...audit, entry].slice(-100);
  }

  private invalid(details?: Record<string, unknown>): never {
    throw new GameError(
      GAME_ERROR_CODES.INVALID_PAYLOAD,
      'errors.payload.invalid',
      details,
    );
  }
}
