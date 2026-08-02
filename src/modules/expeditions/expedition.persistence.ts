import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { evaluateNarrativeConditions } from '../narrative/narrative.condition-resolver.js';
import {
  emptyRegionNarrativeState,
  parseCharacterNarrativeState,
  parseRegionNarrativeState,
} from '../narrative/narrative.state.js';
import type { NarrativeCondition, NarrativeConditionContext } from '../narrative/narrative.types.js';
import type { ExpeditionOperationResult, ExpeditionRunSnapshot } from './expedition.types.js';

export type ExpeditionDatabase = PrismaService | Prisma.TransactionClient;
export const ACTIVE_EXPEDITION_STATUSES = ['PREPARING', 'ACTIVE'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const expeditionJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;

export function parseExpeditionRunSnapshot(value: unknown): ExpeditionRunSnapshot {
  if (!isRecord(value)) throw new Error('EXPEDITION_SNAPSHOT_INVALID');
  if (
    typeof value.runId !== 'string' ||
    typeof value.definitionKey !== 'string' ||
    !Number.isInteger(value.definitionVersion) ||
    typeof value.contentVersion !== 'string' ||
    !Number.isInteger(value.seed) ||
    typeof value.rotationVariantKey !== 'string' ||
    typeof value.createdAt !== 'string' ||
    (value.startedAt !== undefined && typeof value.startedAt !== 'string') ||
    (value.terminalAt !== undefined && typeof value.terminalAt !== 'string') ||
    typeof value.currentNodeKey !== 'string' ||
    !Number.isInteger(value.revision) ||
    !isRecord(value.definitionSnapshot) ||
    !isRecord(value.preparation) ||
    !isRecord(value.riskSnapshot) ||
    !isRecord(value.resources) ||
    !isRecord(value.nodeResolutions) ||
    !isRecord(value.processedOperations) ||
    !Array.isArray(value.visitedNodeKeys) ||
    !Array.isArray(value.pendingLoot) ||
    !Array.isArray(value.securedLoot) ||
    !Array.isArray(value.consequences) ||
    !Array.isArray(value.decisions) ||
    !Array.isArray(value.contributions) ||
    !Array.isArray(value.activeModifiers)
  ) {
    throw new Error('EXPEDITION_SNAPSHOT_INVALID');
  }
  return structuredClone(value) as unknown as ExpeditionRunSnapshot;
}

@Injectable()
export class ExpeditionPersistence {
  constructor(private readonly prisma: PrismaService) {}

  async findCurrentForCharacter(database: ExpeditionDatabase, characterId: string) {
    return database.expeditionMember.findFirst({
      where: {
        characterId,
        run: { status: { in: [...ACTIVE_EXPEDITION_STATUSES] } },
      },
      include: { run: true },
      orderBy: { joinedAt: 'desc' },
    });
  }

  async findLatestForCharacter(database: ExpeditionDatabase, characterId: string) {
    return database.expeditionMember.findFirst({
      where: { characterId },
      include: { run: true },
      orderBy: { joinedAt: 'desc' },
    });
  }

  async lockRun(
    transaction: Prisma.TransactionClient,
    runId: string,
  ): Promise<{ id: string; leaderCharacterId: string; realmId: string; snapshot: Prisma.JsonValue }> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "ExpeditionRun" WHERE "id" = ${runId}::uuid FOR UPDATE
    `);
    if (rows.length !== 1) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    const run = await transaction.expeditionRun.findUnique({
      where: { id: runId },
      select: { id: true, leaderCharacterId: true, realmId: true, snapshot: true },
    });
    if (!run) throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    return run;
  }

  async lockCharacter(
    transaction: Prisma.TransactionClient,
    characterId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Character" WHERE "id" = ${characterId}::uuid FOR UPDATE
    `);
    if (rows.length !== 1) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
  }

  async claimOperation(
    transaction: Prisma.TransactionClient,
    runId: string,
    operationId: string,
    operationType: string,
  ): Promise<ExpeditionOperationResult | undefined> {
    const existing = await transaction.expeditionOperation.findUnique({
      where: { runId_operationId: { runId, operationId } },
    });
    if (existing) {
      if (existing.operationType !== operationType) {
        throw new GameError(
          GAME_ERROR_CODES.INVALID_PAYLOAD,
          'errors.payload.invalid',
          { reason: 'EXPEDITION_OPERATION_COLLISION' },
        );
      }
      if (existing.status === 'COMPLETED') {
        return existing.result as unknown as ExpeditionOperationResult;
      }
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    await transaction.expeditionOperation.create({
      data: {
        runId,
        operationId,
        operationType,
        status: 'PENDING',
        result: {},
      },
    });
    return undefined;
  }

  async completeOperation(
    transaction: Prisma.TransactionClient,
    runId: string,
    operationId: string,
    result: ExpeditionOperationResult,
  ): Promise<void> {
    await transaction.expeditionOperation.update({
      where: { runId_operationId: { runId, operationId } },
      data: { status: 'COMPLETED', result: expeditionJson(result), completedAt: new Date() },
    });
  }

  async persistRun(
    transaction: Prisma.TransactionClient,
    run: ExpeditionRunSnapshot,
  ): Promise<void> {
    await transaction.expeditionRun.update({
      where: { id: run.runId },
      data: {
        status: run.status,
        snapshot: expeditionJson(run),
        revision: run.revision,
        currentNodeKey: run.currentNodeKey,
        terminalAt: ['EXTRACTED', 'FAILED', 'ABANDONED', 'COMPLETED'].includes(run.status)
          ? new Date(run.terminalAt ?? Date.now())
          : undefined,
      },
    });
  }

  async releaseActiveMembers(
    transaction: Prisma.TransactionClient,
    runId: string,
  ): Promise<void> {
    await transaction.expeditionActiveMember.deleteMany({ where: { runId } });
  }

  async buildConditionContext(
    database: ExpeditionDatabase,
    input: {
      characterId: string;
      realmId: string;
      regionKey: string;
      partySize: number;
    },
  ): Promise<NarrativeConditionContext> {
    const [character, items, regionRecord] = await Promise.all([
      database.character.findUnique({
        where: { id: input.characterId },
        select: {
          level: true,
          class: true,
          progressionData: true,
          guildMembership: { select: { role: true } },
        },
      }),
      database.inventoryItem.findMany({
        where: { characterId: input.characterId },
        select: { quantity: true, itemDefinition: { select: { key: true } } },
      }),
      database.narrativeRegionState.findUnique({
        where: { realmId_regionKey: { realmId: input.realmId, regionKey: input.regionKey } },
      }),
    ]);
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    const progression = isRecord(character.progressionData)
      ? character.progressionData
      : {};
    const state = parseCharacterNarrativeState(progression.narrative);
    if (character.guildMembership) state.guild = { role: character.guildMembership.role };
    const inventory = new Map<string, number>();
    for (const item of items) {
      inventory.set(
        item.itemDefinition.key,
        (inventory.get(item.itemDefinition.key) ?? 0) + item.quantity,
      );
    }
    const region = regionRecord
      ? parseRegionNarrativeState({
          ...(isRecord(regionRecord.state) ? regionRecord.state : {}),
          revision: regionRecord.revision,
        })
      : emptyRegionNarrativeState();
    return {
      level: character.level,
      characterClass: character.class,
      inventory,
      partySize: input.partySize,
      character: state,
      regionValues: new Map([
        [input.regionKey, new Map(Object.entries(region.values))],
      ]),
      regionContributions: new Map([
        [input.regionKey, region.characterContributions[input.characterId] ?? 0],
      ]),
      worldCycles: new Map(),
      encounterResults: new Map(),
    };
  }

  async evaluateConditions(
    database: ExpeditionDatabase,
    input: {
      characterId: string;
      realmId: string;
      regionKey: string;
      partySize: number;
      conditions: readonly NarrativeCondition[];
    },
  ): Promise<boolean> {
    return evaluateNarrativeConditions(
      input.conditions,
      await this.buildConditionContext(database, input),
    );
  }
}
