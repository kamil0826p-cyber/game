import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import {
  PROGRESSION_NODES,
  calculateCharacterStats,
  nodeRanks,
  normalizeStatVector,
  progressionPointsForLevel,
  statVectorsEqual,
} from './character-stats.js';
import {
  PROGRESSION_VERSION,
  type ProgressionCharacterRecord,
  type ProgressionMutationResult,
  type ProgressionNodeKey,
  type ProgressionResourcePolicy,
  type ProgressionSnapshot,
  type StatVector,
} from './progression.types.js';

type SqlClient = Prisma.TransactionClient | PrismaService;

interface EquipmentBonusRow {
  bonuses: Prisma.JsonValue;
}

interface UpdatedStatRow {
  hp: number;
  energy: number;
  silver: number;
  stateVersion: number;
  statRevision: number;
}

@Injectable()
export class ProgressionService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(userId: string, characterId: string): Promise<ProgressionSnapshot> {
    const record = await this.loadRecord(this.prisma, characterId, userId);
    const equipment = await this.equipmentBonuses(this.prisma, characterId);
    return this.snapshot(record, equipment);
  }

  async repairCharacter(userId: string, characterId: string): Promise<ProgressionMutationResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, characterId);
      const record = await this.loadRecord(tx, characterId, userId);
      const equipment = await this.equipmentBonuses(tx, characterId);
      const snapshot = this.snapshot(record, equipment);
      const current = this.currentVector(record);
      if (
        record.progressionVersion === PROGRESSION_VERSION &&
        statVectorsEqual(current, snapshot.effective) &&
        record.hp <= snapshot.effective.maxHp &&
        record.energy <= snapshot.effective.maxEnergy
      ) return this.result(record, snapshot);
      return this.persistCalculated(tx, record, snapshot, 'CLAMP', {
        progressionVersion: PROGRESSION_VERSION,
      });
    });
  }

  async choose(
    userId: string,
    characterId: string,
    operationId: string,
    nodeKey: ProgressionNodeKey,
  ): Promise<ProgressionMutationResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, characterId);
      const replay = await this.auditReplay(tx, characterId, operationId);
      if (replay) return this.currentResult(tx, userId, characterId);
      const record = await this.loadRecord(tx, characterId, userId);
      this.assertIdle(record);
      const equipment = await this.equipmentBonuses(tx, characterId);
      const before = this.snapshot(record, equipment);
      const ranks = nodeRanks(before.choices);
      const definition = PROGRESSION_NODES[nodeKey];
      if (!definition || before.points.available < 1 || ranks[nodeKey] >= definition.maxRank) {
        throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
      }
      const choices = [...before.choices, nodeKey];
      const after = calculateCharacterStats({
        characterClass: record.characterClass,
        level: record.level,
        choices,
        legacyAdjustment: record.legacyStatAdjustment,
        equipment,
        freeRespecs: record.freeProgressionRespecs,
      });
      const updated = await this.persistCalculated(tx, record, after, 'ADD_MAX_DELTA', {
        progressionVersion: PROGRESSION_VERSION,
        progressionChoices: choices,
      });
      await this.audit(tx, record.id, operationId, 'CHOICE', before, updated.snapshot, 0);
      return updated;
    });
  }

  async respec(
    userId: string,
    characterId: string,
    operationId: string,
  ): Promise<ProgressionMutationResult> {
    return this.prisma.$transaction(async (tx) => {
      await this.lock(tx, characterId);
      const replay = await this.auditReplay(tx, characterId, operationId);
      if (replay) return this.currentResult(tx, userId, characterId);
      const record = await this.loadRecord(tx, characterId, userId);
      this.assertIdle(record);
      const equipment = await this.equipmentBonuses(tx, characterId);
      const before = this.snapshot(record, equipment);
      const cost = before.respec.silverCost;
      if (record.silver < cost) {
        throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver', {
          required: cost,
          available: record.silver,
        });
      }
      const freeProgressionRespecs = before.choices.length > 0 && record.freeProgressionRespecs > 0
        ? record.freeProgressionRespecs - 1
        : record.freeProgressionRespecs;
      const after = calculateCharacterStats({
        characterClass: record.characterClass,
        level: record.level,
        choices: [],
        legacyAdjustment: record.legacyStatAdjustment,
        equipment,
        freeRespecs: freeProgressionRespecs,
      });
      const updated = await this.persistCalculated(tx, record, after, 'CLAMP', {
        progressionVersion: PROGRESSION_VERSION,
        progressionChoices: [],
        freeProgressionRespecs,
        silver: record.silver - cost,
      });
      if (cost > 0) {
        await tx.characterCurrencyLedger.create({
          data: {
            characterId,
            operationId: `progression-respec:${operationId}`,
            currency: 'SILVER',
            direction: 'DEBIT',
            amount: cost,
            reason: 'PROGRESSION_RESPEC',
            balanceAfter: updated.silver,
            metadata: { progressionVersion: PROGRESSION_VERSION, choicesRemoved: before.choices.length },
          },
        });
      }
      await this.audit(tx, record.id, operationId, 'RESPEC', before, updated.snapshot, cost);
      return updated;
    });
  }

  async recalculateInTransaction(
    tx: Prisma.TransactionClient,
    characterId: string,
    policy: ProgressionResourcePolicy = 'CLAMP',
  ): Promise<ProgressionMutationResult> {
    await this.lock(tx, characterId);
    const record = await this.loadRecord(tx, characterId);
    const equipment = await this.equipmentBonuses(tx, characterId);
    const snapshot = this.snapshot(record, equipment);
    return this.persistCalculated(tx, record, snapshot, policy, {
      progressionVersion: PROGRESSION_VERSION,
    });
  }

  private async currentResult(
    tx: Prisma.TransactionClient,
    userId: string,
    characterId: string,
  ): Promise<ProgressionMutationResult> {
    const record = await this.loadRecord(tx, characterId, userId);
    const equipment = await this.equipmentBonuses(tx, characterId);
    return this.result(record, this.snapshot(record, equipment));
  }

  private snapshot(record: ProgressionCharacterRecord, equipment: StatVector): ProgressionSnapshot {
    return calculateCharacterStats({
      characterClass: record.characterClass,
      level: record.level,
      choices: record.progressionChoices,
      legacyAdjustment: record.legacyStatAdjustment,
      equipment,
      freeRespecs: record.freeProgressionRespecs,
    });
  }

  private async persistCalculated(
    tx: Prisma.TransactionClient,
    record: ProgressionCharacterRecord,
    snapshot: ProgressionSnapshot,
    policy: ProgressionResourcePolicy,
    changes: {
      progressionVersion?: number;
      progressionChoices?: ProgressionNodeKey[];
      freeProgressionRespecs?: number;
      silver?: number;
    },
  ): Promise<ProgressionMutationResult> {
    const hp = policy === 'ADD_MAX_DELTA'
      ? Math.min(snapshot.effective.maxHp, record.hp + Math.max(0, snapshot.effective.maxHp - record.maxHp))
      : Math.min(record.hp, snapshot.effective.maxHp);
    const energy = policy === 'ADD_MAX_DELTA'
      ? Math.min(snapshot.effective.maxEnergy, record.energy + Math.max(0, snapshot.effective.maxEnergy - record.maxEnergy))
      : Math.min(record.energy, snapshot.effective.maxEnergy);
    const choices = changes.progressionChoices ?? snapshot.choices;
    const updated = await tx.$queryRaw<UpdatedStatRow[]>(Prisma.sql`
      UPDATE "Character"
      SET
        "hp" = ${Math.max(0, hp)},
        "maxHp" = ${snapshot.effective.maxHp},
        "energy" = ${Math.max(0, energy)},
        "maxEnergy" = ${snapshot.effective.maxEnergy},
        "strength" = ${snapshot.effective.strength},
        "agility" = ${snapshot.effective.agility},
        "intelligence" = ${snapshot.effective.intelligence},
        "armor" = ${snapshot.effective.armor},
        "silver" = ${changes.silver ?? record.silver},
        "progressionVersion" = ${changes.progressionVersion ?? record.progressionVersion},
        "progressionChoices" = ${JSON.stringify(choices)}::jsonb,
        "freeProgressionRespecs" = ${changes.freeProgressionRespecs ?? record.freeProgressionRespecs},
        "statRevision" = "statRevision" + 1,
        "stateVersion" = "stateVersion" + 1,
        "lastSavedAt" = NOW(),
        "updatedAt" = NOW()
      WHERE "id" = ${record.id}::uuid
      RETURNING "hp", "energy", "silver", "stateVersion", "statRevision"
    `);
    const row = updated[0];
    if (!row) throw new Error(`Character ${record.id} could not be recalculated.`);
    return {
      snapshot: { ...snapshot, choices, points: {
        ...snapshot.points,
        spent: choices.length,
        available: Math.max(0, progressionPointsForLevel(record.level) - choices.length),
      }, respec: {
        ...snapshot.respec,
        freeRespecs: changes.freeProgressionRespecs ?? record.freeProgressionRespecs,
      } },
      hp: row.hp,
      energy: row.energy,
      silver: row.silver,
      stateVersion: row.stateVersion,
      statRevision: row.statRevision,
    };
  }

  private async loadRecord(
    client: SqlClient,
    characterId: string,
    userId?: string,
  ): Promise<ProgressionCharacterRecord> {
    const rows = await client.$queryRaw<ProgressionCharacterRecord[]>(Prisma.sql`
      SELECT
        "id", "userId", "class" AS "characterClass", "level", "hp", "maxHp", "energy", "maxEnergy",
        "strength", "agility", "intelligence", "armor", "silver", "combatState", "stateVersion",
        "progressionVersion", "progressionChoices", "legacyStatAdjustment",
        "freeProgressionRespecs", "statRevision"
      FROM "Character"
      WHERE "id" = ${characterId}::uuid
        ${userId ? Prisma.sql`AND "userId" = ${userId}::uuid` : Prisma.empty}
      LIMIT 1
    `);
    const record = rows[0];
    if (!record) throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.character.required');
    return record;
  }

  private async equipmentBonuses(client: SqlClient, characterId: string): Promise<StatVector> {
    const rows = await client.$queryRaw<EquipmentBonusRow[]>(Prisma.sql`
      SELECT COALESCE(
        "InventoryItem"."instanceData" #> '{__contentSnapshot,definition,metadata,statBonuses}',
        "ItemDefinition"."metadata" -> 'statBonuses',
        '{}'::jsonb
      ) AS "bonuses"
      FROM "InventoryItem"
      JOIN "ItemDefinition" ON "ItemDefinition"."id" = "InventoryItem"."itemDefinitionId"
      WHERE "InventoryItem"."characterId" = ${characterId}::uuid
        AND "InventoryItem"."equippedSlot" IS NOT NULL
    `);
    return rows.reduce<StatVector>((sum, row) => {
      const value = normalizeStatVector(row.bonuses);
      return {
        maxHp: sum.maxHp + value.maxHp,
        maxEnergy: sum.maxEnergy + value.maxEnergy,
        strength: sum.strength + value.strength,
        agility: sum.agility + value.agility,
        intelligence: sum.intelligence + value.intelligence,
        armor: sum.armor + value.armor,
      };
    }, { maxHp: 0, maxEnergy: 0, strength: 0, agility: 0, intelligence: 0, armor: 0 });
  }

  private currentVector(record: ProgressionCharacterRecord): StatVector {
    return {
      maxHp: record.maxHp,
      maxEnergy: record.maxEnergy,
      strength: record.strength,
      agility: record.agility,
      intelligence: record.intelligence,
      armor: record.armor,
    };
  }

  private result(record: ProgressionCharacterRecord, snapshot: ProgressionSnapshot): ProgressionMutationResult {
    return {
      snapshot,
      hp: Math.min(record.hp, snapshot.effective.maxHp),
      energy: Math.min(record.energy, snapshot.effective.maxEnergy),
      silver: record.silver,
      stateVersion: record.stateVersion,
      statRevision: record.statRevision,
    };
  }

  private assertIdle(record: ProgressionCharacterRecord): void {
    if (record.combatState !== 'IDLE') {
      throw new GameError(GAME_ERROR_CODES.COMBAT_MOVEMENT_BLOCKED, 'errors.combat.movementBlocked');
    }
  }

  private lock(tx: Prisma.TransactionClient, characterId: string): Promise<unknown> {
    return tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtext(${'progression:' + characterId}))`);
  }

  private async auditReplay(
    tx: Prisma.TransactionClient,
    characterId: string,
    operationId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<Array<{ exists: boolean }>>(Prisma.sql`
      SELECT EXISTS(
        SELECT 1 FROM "CharacterProgressionAudit"
        WHERE "characterId" = ${characterId}::uuid AND "operationId" = ${operationId}
      ) AS "exists"
    `);
    return rows[0]?.exists ?? false;
  }

  private async audit(
    tx: Prisma.TransactionClient,
    characterId: string,
    operationId: string,
    action: 'CHOICE' | 'RESPEC',
    before: ProgressionSnapshot,
    after: ProgressionSnapshot,
    silverCost: number,
  ): Promise<void> {
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CharacterProgressionAudit" (
        "id", "characterId", "operationId", "action", "progressionVersion",
        "beforeState", "afterState", "silverCost", "createdAt"
      ) VALUES (
        ${randomUUID()}::uuid, ${characterId}::uuid, ${operationId}, ${action}, ${PROGRESSION_VERSION},
        ${JSON.stringify(before)}::jsonb, ${JSON.stringify(after)}::jsonb, ${silverCost}, NOW()
      )
    `);
  }
}
