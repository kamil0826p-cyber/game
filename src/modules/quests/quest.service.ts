import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { SupportedLocale } from '../../i18n/localization.service.js';
import { applyExperience, statGrowthForLevels } from '../mobs/character-progression.js';
import { skillPointsGainedBetweenLevels } from '../skills/skill.rules.js';
import type { PlayerSession } from '../world/player-session.types.js';
import {
  areQuestStepsComplete,
  consumableRequirements,
  emptyQuestProgress,
  evaluateQuestSteps,
  incrementObjectiveProgress,
  matchesMobStep,
  parseQuestProgress,
  parseQuestRewards,
  parseQuestSteps,
  type EvaluatedQuestStep,
  type QuestRewards,
  type QuestStepDefinition,
} from './quest.rules.js';

export type QuestDialogueState = 'NOT_STARTED' | 'ACTIVE' | 'READY' | 'REWARDED';
export type QuestLogStatus = 'ACTIVE' | 'READY' | 'REWARDED';
export interface QuestLogEntryPayload {
  key: string; name: string; description: string; status: QuestLogStatus;
  objectives: EvaluatedQuestStep[]; rewards: QuestRewards; startedAt?: number; completedAt?: number;
}
export interface QuestLogSnapshot { quests: QuestLogEntryPayload[]; }
export interface QuestRewardPayload extends QuestRewards { levelsGained: number; skillPointsGained: number; }
export interface QuestMutationResult {
  questKey: string; state: QuestDialogueState; completed: boolean; reward?: QuestRewardPayload;
  character?: { level: number; experience: number; gold: number; silver: number };
}

type CharacterQuestRecord = {
  id: string; status: 'NOT_STARTED' | 'ACTIVE' | 'COMPLETED' | 'REWARDED' | 'FAILED';
  progress: Prisma.JsonValue; startedAt: Date | null; completedAt: Date | null;
  questDefinition: { id: string; key: string; name: string; description: string; minimumLevel: number; steps: Prisma.JsonValue; rewards: Prisma.JsonValue };
};

@Injectable()
export class QuestService {
  constructor(private readonly prisma: PrismaService) {}

  async getLog(characterId: string, locale: SupportedLocale): Promise<QuestLogSnapshot> {
    const quests = await this.prisma.characterQuest.findMany({
      where: { characterId, status: { in: ['ACTIVE', 'COMPLETED', 'REWARDED'] } },
      include: { questDefinition: true },
      orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }, { createdAt: 'desc' }],
    });
    const inventoryCounts = await this.getInventoryCounts(this.prisma, characterId);
    return { quests: quests.map((quest) => this.toLogEntry(quest as unknown as CharacterQuestRecord, inventoryCounts, locale)) };
  }

  async getDialogueState(characterId: string, questKey: string): Promise<QuestDialogueState> {
    const quest = await this.prisma.questDefinition.findUnique({ where: { key: questKey } });
    if (!quest) throw new GameError(GAME_ERROR_CODES.QUEST_NOT_FOUND, 'errors.quests.notFound');
    const progress = await this.prisma.characterQuest.findUnique({
      where: { characterId_questDefinitionId: { characterId, questDefinitionId: quest.id } },
    });
    if (!progress || progress.status === 'NOT_STARTED' || progress.status === 'FAILED') return 'NOT_STARTED';
    if (progress.status === 'REWARDED') return 'REWARDED';
    const evaluated = evaluateQuestSteps(this.requireSteps(quest), parseQuestProgress(progress.progress), await this.getInventoryCounts(this.prisma, characterId), 'pl');
    return progress.status === 'COMPLETED' || areQuestStepsComplete(evaluated) ? 'READY' : 'ACTIVE';
  }

  async accept(session: PlayerSession, questKey: string): Promise<QuestMutationResult> {
    const state = await this.prisma.$transaction(async (transaction) => {
      const quest = await transaction.questDefinition.findUnique({ where: { key: questKey } });
      if (!quest) throw new GameError(GAME_ERROR_CODES.QUEST_NOT_FOUND, 'errors.quests.notFound');
      this.requireDefinition(quest);
      const character = await transaction.character.findUnique({ where: { id: session.characterId }, select: { userId: true, level: true } });
      if (!character || character.userId !== session.userId) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      if (character.level < quest.minimumLevel) throw new GameError(GAME_ERROR_CODES.QUEST_LEVEL_REQUIRED, 'errors.quests.levelRequired');
      const existing = await transaction.characterQuest.findUnique({
        where: { characterId_questDefinitionId: { characterId: session.characterId, questDefinitionId: quest.id } },
      });
      if (existing?.status === 'REWARDED' || existing?.status === 'COMPLETED') throw new GameError(GAME_ERROR_CODES.QUEST_ALREADY_COMPLETED, 'errors.quests.alreadyCompleted');
      if (existing?.status === 'ACTIVE') return 'ACTIVE' as const;
      if (existing) await transaction.characterQuest.update({ where: { id: existing.id }, data: { status: 'ACTIVE', progress: emptyQuestProgress(), startedAt: new Date(), completedAt: null } });
      else await transaction.characterQuest.create({ data: { characterId: session.characterId, questDefinitionId: quest.id, status: 'ACTIVE', progress: emptyQuestProgress(), startedAt: new Date() } });
      return 'ACTIVE' as const;
    });
    return { questKey, state, completed: false };
  }

  async turnIn(session: PlayerSession, questKey: string, locale: SupportedLocale): Promise<QuestMutationResult> {
    const result = await this.prisma.$transaction(async (transaction) => {
      const characterQuest = await transaction.characterQuest.findFirst({
        where: { characterId: session.characterId, questDefinition: { key: questKey } }, include: { questDefinition: true },
      });
      if (!characterQuest) throw new GameError(GAME_ERROR_CODES.QUEST_NOT_ACTIVE, 'errors.quests.notActive');
      if (characterQuest.status === 'REWARDED') throw new GameError(GAME_ERROR_CODES.QUEST_ALREADY_COMPLETED, 'errors.quests.alreadyCompleted');
      if (characterQuest.status !== 'ACTIVE' && characterQuest.status !== 'COMPLETED') throw new GameError(GAME_ERROR_CODES.QUEST_NOT_ACTIVE, 'errors.quests.notActive');
      const { steps, rewards } = this.requireDefinition(characterQuest.questDefinition);
      const items = await transaction.inventoryItem.findMany({ where: { characterId: session.characterId }, include: { itemDefinition: { select: { key: true } } }, orderBy: { slotIndex: 'asc' } });
      const inventoryCounts = new Map<string, number>();
      for (const item of items) inventoryCounts.set(item.itemDefinition.key, (inventoryCounts.get(item.itemDefinition.key) ?? 0) + item.quantity);
      if (!areQuestStepsComplete(evaluateQuestSteps(steps, parseQuestProgress(characterQuest.progress), inventoryCounts, locale))) return { completed: false as const, state: 'ACTIVE' as const };
      const character = await transaction.character.findUnique({ where: { id: session.characterId } });
      if (!character || character.userId !== session.userId) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      const claimed = await transaction.characterQuest.updateMany({ where: { id: characterQuest.id, status: { in: ['ACTIVE', 'COMPLETED'] } }, data: { status: 'REWARDED', completedAt: new Date() } });
      if (claimed.count !== 1) throw new GameError(GAME_ERROR_CODES.QUEST_ALREADY_COMPLETED, 'errors.quests.alreadyCompleted');
      await this.consumeRequiredItems(transaction, items, consumableRequirements(steps));
      const progression = applyExperience(character.level, character.experience, rewards.experience);
      const growth = statGrowthForLevels(progression.levelsGained);
      const maxHp = character.maxHp + growth.maxHp;
      const maxEnergy = character.maxEnergy + growth.maxEnergy;
      const updated = await transaction.character.update({
        where: { id: character.id },
        data: {
          level: progression.level, experience: progression.experience,
          hp: Math.min(maxHp, character.hp + growth.maxHp), maxHp,
          energy: Math.min(maxEnergy, character.energy + growth.maxEnergy), maxEnergy,
          strength: character.strength + growth.strength, agility: character.agility + growth.agility,
          intelligence: character.intelligence + growth.intelligence, armor: character.armor + growth.armor,
          gold: { increment: rewards.gold }, silver: { increment: rewards.silver }, stateVersion: { increment: 1 }, lastSavedAt: new Date(),
        },
      });
      if (rewards.gold > 0) await this.writeCurrencyLedger(transaction, characterQuest.id, character.id, 'GOLD', rewards.gold, updated.gold, questKey);
      if (rewards.silver > 0) await this.writeCurrencyLedger(transaction, characterQuest.id, character.id, 'SILVER', rewards.silver, updated.silver, questKey);
      return { completed: true as const, state: 'REWARDED' as const, updated, reward: { ...rewards, levelsGained: progression.levelsGained, skillPointsGained: skillPointsGainedBetweenLevels(character.level, progression.level) } };
    });
    if (!result.completed) return { questKey, state: result.state, completed: false };
    const updated = result.updated;
    Object.assign(session, { level: updated.level, experience: updated.experience, hp: updated.hp, maxHp: updated.maxHp, energy: updated.energy, maxEnergy: updated.maxEnergy, strength: updated.strength, agility: updated.agility, intelligence: updated.intelligence, armor: updated.armor, gold: updated.gold, silver: updated.silver });
    session.stateRevision = Math.max(session.stateRevision + 1, updated.stateVersion);
    session.persistedRevision = Math.max(session.persistedRevision, updated.stateVersion);
    session.dirty = false;
    return { questKey, state: 'REWARDED', completed: true, reward: result.reward, character: { level: updated.level, experience: updated.experience, gold: updated.gold, silver: updated.silver } };
  }

  async recordMobKill(characterId: string, mobDefinitionKey: string): Promise<void> { await this.recordObjective(characterId, (step) => matchesMobStep(step, mobDefinitionKey)); }
  async recordNpcTalk(characterId: string, npcKey: string): Promise<void> { await this.recordObjective(characterId, (step) => step.type === 'TALK_TO_NPC' && step.npcKey === npcKey); }

  private async recordObjective(characterId: string, predicate: (step: QuestStepDefinition) => boolean): Promise<void> {
    const active = await this.prisma.characterQuest.findMany({ where: { characterId, status: 'ACTIVE' }, include: { questDefinition: true } });
    for (const quest of active) {
      const steps = this.requireSteps(quest.questDefinition);
      if (!steps.some(predicate)) continue;
      await this.prisma.characterQuest.update({ where: { id: quest.id }, data: { progress: incrementObjectiveProgress(steps, parseQuestProgress(quest.progress), predicate) } });
    }
  }

  private toLogEntry(quest: CharacterQuestRecord, inventoryCounts: ReadonlyMap<string, number>, locale: SupportedLocale): QuestLogEntryPayload {
    const { steps, rewards } = this.requireDefinition(quest.questDefinition);
    const objectives = evaluateQuestSteps(steps, parseQuestProgress(quest.progress), inventoryCounts, locale);
    const status: QuestLogStatus = quest.status === 'REWARDED' ? 'REWARDED' : quest.status === 'COMPLETED' || areQuestStepsComplete(objectives) ? 'READY' : 'ACTIVE';
    return { key: quest.questDefinition.key, name: quest.questDefinition.name, description: quest.questDefinition.description, status, objectives, rewards, startedAt: quest.startedAt?.getTime(), completedAt: quest.completedAt?.getTime() };
  }

  private requireDefinition(definition: { steps: Prisma.JsonValue; rewards: Prisma.JsonValue }): { steps: QuestStepDefinition[]; rewards: QuestRewards } {
    const steps = parseQuestSteps(definition.steps); const rewards = parseQuestRewards(definition.rewards);
    if (!steps || !rewards) throw new GameError(GAME_ERROR_CODES.QUEST_DEFINITION_INVALID, 'errors.quests.definitionInvalid');
    return { steps, rewards };
  }
  private requireSteps(definition: { steps: Prisma.JsonValue }): QuestStepDefinition[] {
    const steps = parseQuestSteps(definition.steps);
    if (!steps) throw new GameError(GAME_ERROR_CODES.QUEST_DEFINITION_INVALID, 'errors.quests.definitionInvalid');
    return steps;
  }
  private async getInventoryCounts(database: PrismaService | Prisma.TransactionClient, characterId: string): Promise<Map<string, number>> {
    const items = await database.inventoryItem.findMany({ where: { characterId }, include: { itemDefinition: { select: { key: true } } } });
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.itemDefinition.key, (counts.get(item.itemDefinition.key) ?? 0) + item.quantity);
    return counts;
  }
  private async consumeRequiredItems(transaction: Prisma.TransactionClient, items: Array<{ id: string; quantity: number; itemDefinition: { key: string } }>, requirements: ReadonlyMap<string, number>): Promise<void> {
    for (const [itemKey, requiredQuantity] of requirements) {
      let remaining = requiredQuantity;
      for (const item of items.filter((candidate) => candidate.itemDefinition.key === itemKey)) {
        if (remaining <= 0) break;
        const consumed = Math.min(remaining, item.quantity);
        if (consumed === item.quantity) await transaction.inventoryItem.delete({ where: { id: item.id } });
        else await transaction.inventoryItem.update({ where: { id: item.id }, data: { quantity: { decrement: consumed } } });
        remaining -= consumed;
      }
      if (remaining > 0) throw new GameError(GAME_ERROR_CODES.QUEST_OBJECTIVES_INCOMPLETE, 'errors.quests.incomplete');
    }
  }
  private async writeCurrencyLedger(transaction: Prisma.TransactionClient, characterQuestId: string, characterId: string, currency: 'GOLD' | 'SILVER', amount: number, balanceAfter: number, questKey: string): Promise<void> {
    await transaction.characterCurrencyLedger.create({ data: { characterId, operationId: `quest:${characterQuestId}:${currency.toLowerCase()}`, currency, direction: 'CREDIT', amount, reason: 'QUEST_REWARD', balanceAfter, metadata: { questKey } } });
  }
}
