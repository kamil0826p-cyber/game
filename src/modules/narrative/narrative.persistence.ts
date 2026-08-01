import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { parseQuestNarrativeProgress } from './narrative.engine.js';
import {
  applyRegionContribution,
  emptyRegionNarrativeState,
  parseCharacterNarrativeState,
  parseRegionNarrativeState,
} from './narrative.state.js';
import type {
  CharacterNarrativeState,
  NarrativeConditionContext,
  NarrativeEffect,
  QuestNarrativeProgress,
  RegionContributionPolicy,
  RegionContributionRequest,
  RegionContributionResult,
} from './narrative.types.js';

export type NarrativeDatabase = PrismaService | Prisma.TransactionClient;
export interface QuestProgressEnvelope { counters: Record<string, number>; stage: number; narrative?: QuestNarrativeProgress; }
export interface ProgressionEnvelope extends Record<string, unknown> { narrative?: CharacterNarrativeState; }
interface StoredOperation { status?: unknown; result?: unknown; }

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
export const toJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

export function progressionEnvelope(value: unknown): ProgressionEnvelope {
  return isRecord(value) ? structuredClone(value) as ProgressionEnvelope : {};
}

export function questProgressEnvelope(value: unknown): QuestProgressEnvelope {
  if (!isRecord(value)) return { counters: {}, stage: 0 };
  const counters: Record<string, number> = {};
  if (isRecord(value.counters)) {
    for (const [key, raw] of Object.entries(value.counters))
      if (Number.isInteger(raw) && Number(raw) >= 0) counters[key] = Number(raw);
  }
  return {
    counters,
    stage: Number.isInteger(value.stage) && Number(value.stage) >= 0 ? Number(value.stage) : 0,
    narrative: parseQuestNarrativeProgress(value.narrative),
  };
}

@Injectable()
export class NarrativePersistence {
  async lockQuest(transaction: Prisma.TransactionClient, characterId: string, questKey: string): Promise<string> {
    const initial = await transaction.characterQuest.findFirst({
      where: { characterId, questDefinition: { key: questKey } }, select: { id: true },
    });
    if (!initial) throw new GameError(GAME_ERROR_CODES.QUEST_NOT_ACTIVE, 'errors.quests.notActive');
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id" FROM "CharacterQuest" WHERE "id" = ${initial.id}::uuid FOR UPDATE
    `);
    return initial.id;
  }

  async buildContext(
    database: NarrativeDatabase,
    characterId: string,
    realmId: string,
    regionKey: string,
    knownState?: CharacterNarrativeState,
  ): Promise<NarrativeConditionContext> {
    const [character, items, regionRecord] = await Promise.all([
      database.character.findUnique({
        where: { id: characterId },
        select: { level: true, class: true, progressionData: true, guildMembership: { select: { role: true } } },
      }),
      database.inventoryItem.findMany({
        where: { characterId },
        select: { quantity: true, itemDefinition: { select: { key: true } } },
      }),
      database.narrativeRegionState.findUnique({ where: { realmId_regionKey: { realmId, regionKey } } }),
    ]);
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    const progression = progressionEnvelope(character.progressionData);
    const state = knownState ?? parseCharacterNarrativeState(progression.narrative);
    if (character.guildMembership) state.guild = { role: character.guildMembership.role };
    const inventory = new Map<string, number>();
    for (const item of items) inventory.set(item.itemDefinition.key, (inventory.get(item.itemDefinition.key) ?? 0) + item.quantity);
    const region = regionRecord
      ? parseRegionNarrativeState({ ...(isRecord(regionRecord.state) ? regionRecord.state : {}), revision: regionRecord.revision })
      : emptyRegionNarrativeState();
    return {
      level: character.level,
      characterClass: character.class,
      inventory,
      partySize: 1,
      character: state,
      regionValues: new Map([[regionKey, new Map(Object.entries(region.values))]]),
      worldCycles: new Map(),
      encounterResults: new Map(),
    };
  }

  async applyDelegatedEffects(
    transaction: Prisma.TransactionClient,
    session: PlayerSession,
    initialState: CharacterNarrativeState,
    effects: readonly NarrativeEffect[],
    scopeKey: string,
  ): Promise<CharacterNarrativeState> {
    const state = structuredClone(initialState);
    for (const effect of effects) {
      switch (effect.type) {
        case 'APPLY_CONSEQUENCE':
        case 'REMOVE_CONSEQUENCE': {
          const direction = effect.type === 'APPLY_CONSEQUENCE' ? 1 : -1;
          if (effect.consequenceKind === 'CORRUPTION') {
            state.consequences.corruption = Math.min(100, Math.max(0, state.consequences.corruption + direction * (effect.amount ?? 1)));
          } else if (effect.consequenceKind === 'WOUND') {
            state.consequences.wounds[effect.consequenceKey] = Math.max(0, (state.consequences.wounds[effect.consequenceKey] ?? 0) + direction * (effect.amount ?? 1));
          } else if (effect.type === 'APPLY_CONSEQUENCE') {
            state.consequences.oaths[effect.consequenceKey] = 'ACTIVE';
          } else {
            delete state.consequences.oaths[effect.consequenceKey];
          }
          break;
        }
        case 'GRANT_RESOURCE':
        case 'TAKE_RESOURCE': {
          if (effect.resourceKey !== 'SILVER') break;
          const delta = effect.type === 'GRANT_RESOURCE' ? effect.amount : -effect.amount;
          const current = await transaction.character.findUnique({ where: { id: session.characterId }, select: { silver: true } });
          if (!current || current.silver + delta < 0) throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver');
          const updated = await transaction.character.update({
            where: { id: session.characterId }, data: { silver: { increment: delta } }, select: { silver: true },
          });
          await transaction.characterCurrencyLedger.create({
            data: {
              characterId: session.characterId,
              operationId: `${scopeKey}:${effect.operationKey}`,
              currency: 'SILVER',
              direction: delta >= 0 ? 'CREDIT' : 'DEBIT',
              amount: Math.abs(delta),
              reason: 'NARRATIVE_EFFECT',
              balanceAfter: updated.silver,
              metadata: { operationKey: effect.operationKey, reason: effect.reason },
            },
          });
          break;
        }
        case 'CONTRIBUTE_REGION':
          await this.applyRegion(
            transaction,
            session.realmId,
            effect.regionKey,
            {
              operationId: `${scopeKey}:${effect.operationKey}`,
              characterId: session.characterId,
              valueKey: effect.valueKey,
              amount: effect.amount,
              qualified: true,
              afk: false,
              reason: effect.reason,
            },
            { minimumMeaningfulAmount: 1, perCharacterCap: 100, perGroupCap: 500, perGuildCap: 2_000 },
          );
          break;
        default:
          break;
      }
    }
    return state;
  }

  async applyRegion(
    transaction: Prisma.TransactionClient,
    realmId: string,
    regionKey: string,
    request: RegionContributionRequest,
    policy: RegionContributionPolicy,
  ): Promise<RegionContributionResult> {
    await transaction.narrativeRegionState.upsert({
      where: { realmId_regionKey: { realmId, regionKey } },
      create: { realmId, regionKey, state: toJson(emptyRegionNarrativeState()) },
      update: {},
    });
    await transaction.$queryRaw(Prisma.sql`
      SELECT "realmId" FROM "NarrativeRegionState"
      WHERE "realmId" = ${realmId}::uuid AND "regionKey" = ${regionKey} FOR UPDATE
    `);
    const record = await transaction.narrativeRegionState.findUnique({ where: { realmId_regionKey: { realmId, regionKey } } });
    const current = record
      ? parseRegionNarrativeState({ ...(isRecord(record.state) ? record.state : {}), revision: record.revision })
      : emptyRegionNarrativeState();
    const applied = applyRegionContribution(current, request, policy);
    if (applied.state !== current) {
      await transaction.narrativeRegionState.update({
        where: { realmId_regionKey: { realmId, regionKey } },
        data: { revision: applied.state.revision, state: toJson(applied.state) },
      });
    }
    return applied.result;
  }

  async claimOperation(
    database: NarrativeDatabase,
    scopeKey: string,
    operationId: string,
    eventType: string,
    reason: string,
    characterId?: string,
    characterQuestId?: string,
  ): Promise<Record<string, unknown> | undefined> {
    const existing = await database.narrativeOperation.findUnique({
      where: { scopeKey_operationId: { scopeKey, operationId } }, select: { payload: true },
    });
    const existingPayload = isRecord(existing?.payload) ? existing.payload as StoredOperation : undefined;
    if (existingPayload?.status === 'COMPLETED' && isRecord(existingPayload.result)) return existingPayload.result;
    const inserted = await database.narrativeOperation.createMany({
      data: [{ scopeKey, operationId, eventType, reason, characterId, characterQuestId, payload: toJson({ status: 'PENDING' }) }],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return undefined;
    const replay = await database.narrativeOperation.findUnique({
      where: { scopeKey_operationId: { scopeKey, operationId } }, select: { payload: true },
    });
    const payload = isRecord(replay?.payload) ? replay.payload as StoredOperation : undefined;
    if (payload?.status === 'COMPLETED' && isRecord(payload.result)) return payload.result;
    throw new GameError(GAME_ERROR_CODES.INTERNAL_ERROR, 'errors.internal', { reason: 'NARRATIVE_OPERATION_PENDING' });
  }

  async completeOperation(database: NarrativeDatabase, scopeKey: string, operationId: string, result: unknown): Promise<void> {
    await database.narrativeOperation.update({
      where: { scopeKey_operationId: { scopeKey, operationId } },
      data: { payload: toJson({ status: 'COMPLETED', result }) },
    });
  }

  async writeAudit(
    database: NarrativeDatabase,
    scopeKey: string,
    operationId: string,
    eventType: string,
    reason: string,
    characterId: string | undefined,
    characterQuestId: string | undefined,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await database.narrativeOperation.createMany({
      data: [{
        scopeKey,
        operationId,
        eventType,
        reason,
        characterId,
        characterQuestId,
        payload: toJson({ status: 'AUDIT', payload }),
      }],
      skipDuplicates: true,
    });
  }
}
