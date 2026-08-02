import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
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
  type NarrativeActor,
} from './narrative.persistence.js';
import { applyNarrativeEffects, parseCharacterNarrativeState } from './narrative.state.js';
import type {
  CharacterNarrativeState,
  NarrativeAuthoritativeEvent,
  NarrativeChoiceResult,
  NarrativeEffect,
  NarrativeEventResult,
  QuestNarrativeProgress,
  RegionContributionPolicy,
  RegionContributionRequest,
  RegionContributionResult,
} from './narrative.types.js';

export interface NarrativeChoiceMutation { result: NarrativeChoiceResult; view: PublicNarrativeView; }
export interface NarrativeEventMutation { result: NarrativeEventResult; view: PublicNarrativeView; }
interface PersistedNarrativeCharacter { stateVersion: number; silver: number; }
interface AppliedEffectBundle { state: CharacterNarrativeState; persisted?: PersistedNarrativeCharacter; }
const operationIdPattern = /^[A-Za-z0-9:_-]{1,128}$/;

@Injectable()
export class NarrativeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly persistence: NarrativePersistence,
    private readonly world: WorldStateService,
  ) {}

  async getQuestView(
    characterId: string,
    realmId: string,
    regionKey: string,
    questKey: string,
  ): Promise<PublicNarrativeView> {
    const record = await this.prisma.characterQuest.findFirst({
      where: { characterId, questDefinition: { key: questKey } },
      select: { progress: true },
    });
    const narrative = questProgressEnvelope(record?.progress).narrative;
    if (!narrative) {
      throw new GameError(GAME_ERROR_CODES.QUEST_NOT_ACTIVE, 'errors.quests.notActive');
    }
    return compilePublicNarrativeView(
      narrative,
      await this.persistence.buildContext(this.prisma, characterId, realmId, regionKey),
    );
  }

  async choose(
    session: PlayerSession,
    questKey: string,
    operationId: string,
    optionKey: string,
  ): Promise<NarrativeChoiceMutation> {
    this.requireOperationId(operationId);
    try {
      const committed = await this.prisma.$transaction(async (transaction) => {
        const questId = await this.persistence.lockQuest(transaction, session.characterId, questKey);
        const scopeKey = `quest:${questId}`;
        const replay = await this.persistence.claimOperation(
          transaction,
          scopeKey,
          operationId,
          'QUEST_CHOICE',
          'PLAYER_CHOICE',
          session.characterId,
          questId,
        );
        if (replay) {
          return { mutation: replay as unknown as NarrativeChoiceMutation, replayed: true as const };
        }

        await this.persistence.lockCharacter(transaction, session.characterId);
        const quest = await transaction.characterQuest.findUnique({
          where: { id: questId },
          select: { progress: true },
        });
        const envelope = questProgressEnvelope(quest?.progress);
        if (!envelope.narrative) {
          throw new GameError(
            GAME_ERROR_CODES.QUEST_DEFINITION_INVALID,
            'errors.quests.definitionInvalid',
          );
        }

        const initialContext = await this.persistence.buildContext(
          transaction,
          session.characterId,
          session.realmId,
          session.mapId,
        );
        const choice = applyNarrativeChoice(
          envelope.narrative,
          operationId,
          optionKey,
          initialContext,
        );
        const applied = await this.applyEffectBundle(
          transaction,
          session,
          questId,
          operationId,
          choice.progress,
          choice.effects,
        );

        envelope.narrative = choice.progress;
        await transaction.characterQuest.update({
          where: { id: questId },
          data: { progress: toJson(envelope) },
        });
        const finalContext = await this.persistence.buildContext(
          transaction,
          session.characterId,
          session.realmId,
          session.mapId,
          applied.state,
        );
        const mutation: NarrativeChoiceMutation = {
          result: choice.result,
          view: compilePublicNarrativeView(choice.progress, finalContext),
        };
        await this.writeOutcomeAnalytics(
          transaction,
          questId,
          operationId,
          session.characterId,
          choice.progress,
        );
        await this.persistence.completeOperation(transaction, scopeKey, operationId, mutation);
        return { mutation, persisted: applied.persisted, replayed: false as const };
      });

      if (!committed.replayed && committed.persisted) {
        this.syncSession(session, committed.persisted);
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
      const committed = await this.prisma.$transaction(async (transaction) => {
        const questId = await this.persistence.lockQuest(transaction, characterId, questKey);
        const scopeKey = `quest:${questId}`;
        const replay = await this.persistence.claimOperation(
          transaction,
          scopeKey,
          event.operationId,
          'QUEST_EVENT',
          event.type,
          characterId,
          questId,
        );
        if (replay) {
          return { mutation: replay as unknown as NarrativeEventMutation, replayed: true as const };
        }

        await this.persistence.lockCharacter(transaction, characterId);
        const quest = await transaction.characterQuest.findUnique({
          where: { id: questId },
          select: { progress: true },
        });
        const envelope = questProgressEnvelope(quest?.progress);
        if (!envelope.narrative) {
          throw new GameError(
            GAME_ERROR_CODES.QUEST_DEFINITION_INVALID,
            'errors.quests.definitionInvalid',
          );
        }

        const changed = applyAuthoritativeNarrativeEvent(envelope.narrative, event);
        const applied = await this.applyEffectBundle(
          transaction,
          { characterId, realmId },
          questId,
          event.operationId,
          changed.progress,
          changed.effects,
        );
        envelope.narrative = changed.progress;
        await transaction.characterQuest.update({
          where: { id: questId },
          data: { progress: toJson(envelope) },
        });
        const mutation: NarrativeEventMutation = {
          result: changed.result,
          view: compilePublicNarrativeView(
            changed.progress,
            await this.persistence.buildContext(
              transaction,
              characterId,
              realmId,
              regionKey,
              applied.state,
            ),
          ),
        };
        await this.writeOutcomeAnalytics(
          transaction,
          questId,
          event.operationId,
          characterId,
          changed.progress,
        );
        await this.persistence.completeOperation(
          transaction,
          scopeKey,
          event.operationId,
          mutation,
        );
        return { mutation, persisted: applied.persisted, replayed: false as const };
      });

      if (!committed.replayed && committed.persisted) {
        this.syncLiveSession(characterId, committed.persisted);
      }
      return committed.mutation;
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
      const committed = await this.prisma.$transaction(async (transaction) => {
        const questId = await this.persistence.lockQuest(transaction, characterId, questKey);
        const scopeKey = `quest:${questId}`;
        const replay = await this.persistence.claimOperation(
          transaction,
          scopeKey,
          operationId,
          'QUEST_FAILURE',
          'FAIL_FORWARD',
          characterId,
          questId,
        );
        if (replay) {
          return { mutation: replay as unknown as NarrativeEventMutation, replayed: true as const };
        }

        await this.persistence.lockCharacter(transaction, characterId);
        const quest = await transaction.characterQuest.findUnique({
          where: { id: questId },
          select: { progress: true },
        });
        const envelope = questProgressEnvelope(quest?.progress);
        if (!envelope.narrative) {
          throw new GameError(
            GAME_ERROR_CODES.QUEST_DEFINITION_INVALID,
            'errors.quests.definitionInvalid',
          );
        }

        const changed = applyFailForward(envelope.narrative, operationId);
        const applied = await this.applyEffectBundle(
          transaction,
          { characterId, realmId },
          questId,
          operationId,
          changed.progress,
          changed.effects,
        );
        envelope.narrative = changed.progress;
        await transaction.characterQuest.update({
          where: { id: questId },
          data: { progress: toJson(envelope) },
        });
        const mutation: NarrativeEventMutation = {
          result: changed.result,
          view: compilePublicNarrativeView(
            changed.progress,
            await this.persistence.buildContext(
              transaction,
              characterId,
              realmId,
              regionKey,
              applied.state,
            ),
          ),
        };
        await this.writeOutcomeAnalytics(
          transaction,
          questId,
          operationId,
          characterId,
          changed.progress,
        );
        await this.persistence.completeOperation(transaction, scopeKey, operationId, mutation);
        return { mutation, persisted: applied.persisted, replayed: false as const };
      });

      if (!committed.replayed && committed.persisted) {
        this.syncLiveSession(characterId, committed.persisted);
      }
      return committed.mutation;
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
      const result = await this.persistence.applyRegion(
        transaction,
        realmId,
        regionKey,
        request,
        policy,
      );
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

  private async applyEffectBundle(
    transaction: Prisma.TransactionClient,
    actor: NarrativeActor,
    questId: string,
    requestOperationId: string,
    progress: QuestNarrativeProgress,
    effects: readonly NarrativeEffect[],
  ): Promise<AppliedEffectBundle> {
    const character = await transaction.character.findUnique({
      where: { id: actor.characterId },
      select: { progressionData: true, progressionVersion: true },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }

    const progression = progressionEnvelope(character.progressionData);
    const currentState = parseCharacterNarrativeState(progression.narrative);
    const policies = new Map(
      (progress.definitionSnapshot.factionPolicies ?? []).map((policy) => [policy.key, policy]),
    );
    const applied = applyNarrativeEffects(currentState, effects, policies);
    const nextState = await this.persistence.applyDelegatedEffects(
      transaction,
      actor,
      applied.state,
      applied.externalEffects,
      `quest:${questId}:${requestOperationId}`,
    );

    let persisted: PersistedNarrativeCharacter | undefined;
    if (effects.length > 0) {
      progression.narrative = nextState;
      const updated = await transaction.character.updateMany({
        where: {
          id: actor.characterId,
          progressionVersion: character.progressionVersion,
        },
        data: {
          progressionData: toJson(progression),
          progressionVersion: { increment: 1 },
          stateVersion: { increment: 1 },
          lastSavedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        throw new GameError(GAME_ERROR_CODES.INTERNAL_ERROR, 'errors.internal', {
          reason: 'NARRATIVE_CHARACTER_CONFLICT',
        });
      }
      persisted = await transaction.character.findUnique({
        where: { id: actor.characterId },
        select: { stateVersion: true, silver: true },
      }) ?? undefined;
    }

    const auditScope = `audit:${questId}:${requestOperationId}`;
    for (const audit of applied.audits) {
      await this.persistence.writeAudit(
        transaction,
        auditScope,
        audit.operationId,
        audit.eventType,
        audit.reason,
        actor.characterId,
        questId,
        audit.payload,
      );
    }
    return { state: nextState, persisted };
  }

  private async writeOutcomeAnalytics(
    transaction: Prisma.TransactionClient,
    questId: string,
    operationId: string,
    characterId: string,
    progress: QuestNarrativeProgress,
  ): Promise<void> {
    if (!progress.outcomeKey || !progress.terminalState) return;
    await this.persistence.writeAudit(
      transaction,
      `analytics:${questId}`,
      operationId,
      'NARRATIVE_OUTCOME',
      'TERMINAL_TRANSITION',
      characterId,
      questId,
      {
        definitionKey: progress.definitionKey,
        definitionVersion: progress.definitionVersion,
        outcomeKey: progress.outcomeKey,
        terminalState: progress.terminalState,
      },
    );
  }

  private syncLiveSession(
    characterId: string,
    persisted: PersistedNarrativeCharacter,
  ): void {
    const session = this.world.getByCharacterId(characterId);
    if (session) this.syncSession(session, persisted);
  }

  private syncSession(session: PlayerSession, persisted: PersistedNarrativeCharacter): void {
    session.silver = persisted.silver;
    session.stateRevision = Math.max(session.stateRevision + 1, persisted.stateVersion);
    session.persistedRevision = Math.max(session.persistedRevision, persisted.stateVersion);
    session.dirty = true;
  }

  private requireOperationId(operationId: string): void {
    if (!operationIdPattern.test(operationId)) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
  }

  private toPublicError(error: unknown): Error {
    if (error instanceof GameError) return error;
    if (error instanceof Error && error.message.startsWith('NARRATIVE_')) {
      return new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
        reason: error.message,
      });
    }
    return error instanceof Error ? error : new Error('Unknown narrative error.');
  }
}
