import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import {
  applyAuthoritativeNarrativeEvent,
  applyFailForward,
  applyNarrativeChoice,
  compilePublicNarrativeView,
  type PublicNarrativeView,
} from './narrative.engine.js';
import {
  NarrativePersistence,
  progressionEnvelope,
  questProgressEnvelope,
  toJson,
} from './narrative.persistence.js';
import { applyNarrativeEffects, parseCharacterNarrativeState } from './narrative.state.js';
import type {
  NarrativeAuthoritativeEvent,
  NarrativeChoiceResult,
  NarrativeEventResult,
  RegionContributionPolicy,
  RegionContributionRequest,
  RegionContributionResult,
} from './narrative.types.js';

export interface NarrativeChoiceMutation { result: NarrativeChoiceResult; view: PublicNarrativeView; }
export interface NarrativeEventMutation { result: NarrativeEventResult; view: PublicNarrativeView; }
const operationIdPattern = /^[A-Za-z0-9:_-]{1,128}$/;

@Injectable()
export class NarrativeService {
  constructor(private readonly prisma: PrismaService, private readonly persistence: NarrativePersistence) {}

  async getQuestView(characterId: string, realmId: string, regionKey: string, questKey: string): Promise<PublicNarrativeView> {
    const record = await this.prisma.characterQuest.findFirst({
      where: { characterId, questDefinition: { key: questKey } }, select: { progress: true },
    });
    const narrative = questProgressEnvelope(record?.progress).narrative;
    if (!narrative) throw new GameError(GAME_ERROR_CODES.QUEST_NOT_ACTIVE, 'errors.quests.notActive');
    return compilePublicNarrativeView(
      narrative,
      await this.persistence.buildContext(this.prisma, characterId, realmId, regionKey),
    );
  }

  async choose(session: PlayerSession, questKey: string, operationId: string, optionKey: string): Promise<NarrativeChoiceMutation> {
    this.requireOperationId(operationId);
    try {
      const committed = await this.prisma.$transaction(async (transaction) => {
        const questId = await this.persistence.lockQuest(transaction, session.characterId, questKey);
        const scopeKey = `quest:${questId}`;
        const replay = await this.persistence.claimOperation(
          transaction, scopeKey, operationId, 'QUEST_CHOICE', 'PLAYER_CHOICE', session.characterId, questId,
        );
        if (replay) {
          const persisted = await transaction.character.findUnique({
            where: { id: session.characterId }, select: { stateVersion: true, silver: true },
          });
          return { mutation: replay as unknown as NarrativeChoiceMutation, persisted };
        }
        const [quest, character] = await Promise.all([
          transaction.characterQuest.findUnique({ where: { id: questId }, select: { progress: true } }),
          transaction.character.findUnique({
            where: { id: session.characterId }, select: { progressionData: true, progressionVersion: true },
          }),
        ]);
        if (!quest || !character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
        const envelope = questProgressEnvelope(quest.progress);
        if (!envelope.narrative) throw new GameError(GAME_ERROR_CODES.QUEST_DEFINITION_INVALID, 'errors.quests.definitionInvalid');
        const progression = progressionEnvelope(character.progressionData);
        const characterState = parseCharacterNarrativeState(progression.narrative);
        const context = await this.persistence.buildContext(
          transaction, session.characterId, session.realmId, session.mapId, characterState,
        );
        const choice = applyNarrativeChoice(envelope.narrative, operationId, optionKey, context);
        const policies = new Map(
          (choice.progress.definitionSnapshot.factionPolicies ?? []).map((policy) => [policy.key, policy]),
        );
        const applied = applyNarrativeEffects(characterState, choice.effects, policies);
        progression.narrative = await this.persistence.applyDelegatedEffects(
          transaction, session, applied.state, choice.effects, scopeKey,
        );
        const updated = await transaction.character.updateMany({
          where: { id: session.characterId, progressionVersion: character.progressionVersion },
          data: {
            progressionData: toJson(progression),
            progressionVersion: { increment: 1 },
            stateVersion: { increment: 1 },
            lastSavedAt: new Date(),
          },
        });
        if (updated.count !== 1) throw new GameError(GAME_ERROR_CODES.INTERNAL_ERROR, 'errors.internal', { reason: 'NARRATIVE_CHARACTER_CONFLICT' });
        envelope.narrative = choice.progress;
        await transaction.characterQuest.update({ where: { id: questId }, data: { progress: toJson(envelope) } });
        for (const event of applied.audits) {
          await this.persistence.writeAudit(
            transaction, scopeKey, event.operationId, event.eventType, event.reason,
            session.characterId, questId, event.payload,
          );
        }
        const mutation: NarrativeChoiceMutation = {
          result: choice.result,
          view: compilePublicNarrativeView(choice.progress, { ...context, character: progression.narrative }),
        };
        await this.persistence.completeOperation(transaction, scopeKey, operationId, mutation);
        const persisted = await transaction.character.findUnique({
          where: { id: session.characterId }, select: { stateVersion: true, silver: true },
        });
        return { mutation, persisted };
      });
      if (committed.persisted) {
        session.silver = committed.persisted.silver;
        session.stateRevision = Math.max(session.stateRevision + 1, committed.persisted.stateVersion);
        session.persistedRevision = Math.max(session.persistedRevision, committed.persisted.stateVersion);
        session.dirty = false;
      }
      return committed.mutation;
    } catch (error) {
      throw this.toPublicError(error);
    }
  }

  async recordAuthoritativeEvent(
    characterId: string,
    realmId: string,
    regionKey: string,
    questKey: string,
    event: NarrativeAuthoritativeEvent,
  ): Promise<NarrativeEventMutation> {
    this.requireOperationId(event.operationId);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const questId = await this.persistence.lockQuest(transaction, characterId, questKey);
        const scopeKey = `quest:${questId}`;
        const replay = await this.persistence.claimOperation(
          transaction, scopeKey, event.operationId, 'QUEST_EVENT', event.type, characterId, questId,
        );
        if (replay) return replay as unknown as NarrativeEventMutation;
        const quest = await transaction.characterQuest.findUnique({ where: { id: questId }, select: { progress: true } });
        const envelope = questProgressEnvelope(quest?.progress);
        if (!envelope.narrative) throw new GameError(GAME_ERROR_CODES.QUEST_DEFINITION_INVALID, 'errors.quests.definitionInvalid');
        const changed = applyAuthoritativeNarrativeEvent(envelope.narrative, event);
        envelope.narrative = changed.progress;
        await transaction.characterQuest.update({ where: { id: questId }, data: { progress: toJson(envelope) } });
        const mutation: NarrativeEventMutation = {
          result: changed.result,
          view: compilePublicNarrativeView(
            changed.progress,
            await this.persistence.buildContext(transaction, characterId, realmId, regionKey),
          ),
        };
        await this.persistence.completeOperation(transaction, scopeKey, event.operationId, mutation);
        return mutation;
      });
    } catch (error) {
      throw this.toPublicError(error);
    }
  }

  async resolveFailure(
    characterId: string,
    realmId: string,
    regionKey: string,
    questKey: string,
    operationId: string,
  ): Promise<NarrativeEventMutation> {
    this.requireOperationId(operationId);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const questId = await this.persistence.lockQuest(transaction, characterId, questKey);
        const scopeKey = `quest:${questId}`;
        const replay = await this.persistence.claimOperation(
          transaction, scopeKey, operationId, 'QUEST_FAILURE', 'FAIL_FORWARD', characterId, questId,
        );
        if (replay) return replay as unknown as NarrativeEventMutation;
        const quest = await transaction.characterQuest.findUnique({ where: { id: questId }, select: { progress: true } });
        const envelope = questProgressEnvelope(quest?.progress);
        if (!envelope.narrative) throw new GameError(GAME_ERROR_CODES.QUEST_DEFINITION_INVALID, 'errors.quests.definitionInvalid');
        const changed = applyFailForward(envelope.narrative, operationId);
        envelope.narrative = changed.progress;
        await transaction.characterQuest.update({ where: { id: questId }, data: { progress: toJson(envelope) } });
        const mutation: NarrativeEventMutation = {
          result: changed.result,
          view: compilePublicNarrativeView(
            changed.progress,
            await this.persistence.buildContext(transaction, characterId, realmId, regionKey),
          ),
        };
        await this.persistence.completeOperation(transaction, scopeKey, operationId, mutation);
        return mutation;
      });
    } catch (error) {
      throw this.toPublicError(error);
    }
  }

  async contributeRegion(
    realmId: string,
    regionKey: string,
    request: RegionContributionRequest,
    policy: RegionContributionPolicy,
  ): Promise<RegionContributionResult> {
    this.requireOperationId(request.operationId);
    return this.prisma.$transaction(async (transaction) => {
      const result = await this.persistence.applyRegion(transaction, realmId, regionKey, request, policy);
      await this.persistence.writeAudit(
        transaction,
        `region:${realmId}:${regionKey}`,
        request.operationId,
        'REGION_CONTRIBUTION',
        result.reason,
        request.characterId,
        undefined,
        { ...result, valueKey: request.valueKey },
      );
      return result;
    });
  }

  private requireOperationId(operationId: string): void {
    if (!operationIdPattern.test(operationId)) throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
  }

  private toPublicError(error: unknown): Error {
    if (error instanceof GameError) return error;
    if (error instanceof Error && error.message.startsWith('NARRATIVE_')) {
      return new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', { reason: error.message });
    }
    return error instanceof Error ? error : new Error('Unknown narrative error.');
  }
}
