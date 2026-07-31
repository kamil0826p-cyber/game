import { Injectable } from '@nestjs/common';
import type { CharacterClass } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { SupportedLocale } from '../../i18n/localization.service.js';
import { TelemetryService } from '../../telemetry/telemetry.service.js';
import { ProgressionService } from '../characters/progression.service.js';
import { parseNpcDialogueDefinition } from '../npcs/npc-dialogue.js';
import { skillsForClass } from '../skills/skill.catalog.js';
import type { PlayerSession } from '../world/player-session.types.js';
import {
  areQuestStepsComplete,
  consumableRequirements,
  emptyQuestProgress,
  evaluateQuestSteps,
  getActiveQuestStage,
  incrementObjectiveProgress,
  matchesMobStep,
  parseQuestProgress,
  parseQuestRewards,
  parseQuestSteps,
  reconcileQuestProgress,
  type EvaluatedQuestStep,
  type QuestProgressState,
  type QuestRewards,
  type QuestStepDefinition,
} from './quest.rules.js';

export type QuestDialogueState = 'NOT_STARTED' | 'ACTIVE' | 'READY' | 'REWARDED';
export type QuestLogStatus = 'ACTIVE' | 'READY' | 'REWARDED';
export interface QuestNpcBindingPayload { npcKey: string; questKey: string; }
export interface QuestLogEntryPayload {
  key: string; name: string; description: string; status: QuestLogStatus;
  activeStage?: number; objectives: EvaluatedQuestStep[]; rewards: QuestRewards; startedAt?: number; completedAt?: number;
}
export interface QuestLogSnapshot { quests: QuestLogEntryPayload[]; npcBindings: QuestNpcBindingPayload[]; }
export interface QuestDialogueContext { state: QuestDialogueState; activeStage?: number; }
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

function questProgressJson(progress: QuestProgressState): Prisma.InputJsonObject {
  return { counters: { ...progress.counters }, stage: progress.stage };
}

function progressChanged(previous: QuestProgressState, next: QuestProgressState): boolean {
  if (previous.stage !== next.stage) return true;
  const keys = new Set([...Object.keys(previous.counters), ...Object.keys(next.counters)]);
  for (const key of keys) if ((previous.counters[key] ?? 0) !== (next.counters[key] ?? 0)) return true;
  return false;
}

@Injectable()
export class QuestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progression: ProgressionService,
    private readonly telemetry: TelemetryService,
  ) {}

  async getLog(characterId: string, locale: SupportedLocale, mapId: string): Promise<QuestLogSnapshot> {
    const [quests, inventoryCounts, npcRecords] = await Promise.all([
      this.prisma.characterQuest.findMany({
        where: { characterId, status: { in: ['ACTIVE', 'COMPLETED', 'REWARDED'] } },
        include: { questDefinition: true },
        orderBy: [{ completedAt: 'desc' }, { startedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.getInventoryCounts(this.prisma, characterId),
      this.prisma.npcDefinition.findMany({ where: { mapId }, select: { key: true, dialogue: true } }),
    ]);
    const entries = await Promise.all(quests.map(async (quest) => {
      const record = quest as unknown as CharacterQuestRecord;
      const steps = this.requireSteps(record.questDefinition);
      const progress = await this.normalizeProgress(this.prisma, record.id, steps, parseQuestProgress(record.progress), inventoryCounts);
      return this.toLogEntry(record, progress, inventoryCounts, locale);
    }));
    const npcBindings = npcRecords.flatMap((npc): QuestNpcBindingPayload[] => {
      const dialogue = parseNpcDialogueDefinition(npc.dialogue);
      return dialogue?.type === 'QUEST' && dialogue.quest
        ? [{ npcKey: npc.key, questKey: dialogue.quest.questKey }]
        : [];
    });
    return { quests: entries, npcBindings };
  }

  async getDialogueContext(characterId: string, questKey: string): Promise<QuestDialogueContext> {
    const quest = await this.prisma.questDefinition.findUnique({ where: { key: questKey } });
    if (!quest) throw new GameError(GAME_ERROR_CODES.QUEST_NOT_FOUND, 'errors.quests.notFound');
    const characterQuest = await this.prisma.characterQuest.findUnique({
      where: { characterId_questDefinitionId: { characterId, questDefinitionId: quest.id } },
    });
    if (!characterQuest || characterQuest.status === 'NOT_STARTED' || characterQuest.status === 'FAILED') return { state: 'NOT_STARTED' };
    if (characterQuest.status === 'REWARDED') return { state: 'REWARDED' };
    const steps = this.requireSteps(quest);
    const inventoryCounts = await this.getInventoryCounts(this.prisma, characterId);
    const progress = await this.normalizeProgress(this.prisma, characterQuest.id, steps, parseQuestProgress(characterQuest.progress), inventoryCounts);
    const evaluated = evaluateQuestSteps(steps, progress, inventoryCounts, 'pl');
    if (characterQuest.status === 'COMPLETED' || areQuestStepsComplete(evaluated)) return { state: 'READY' };
    return { state: 'ACTIVE', activeStage: getActiveQuestStage(steps, progress) };
  }

  async getDialogueState(characterId: string, questKey: string): Promise<QuestDialogueState> {
    return (await this.getDialogueContext(characterId, questKey)).state;
  }

  async accept(session: PlayerSession, questKey: string): Promise<QuestMutationResult> {
    const result = await this.prisma.$transaction(async (transaction) => {
      const quest = await transaction.questDefinition.findUnique({ where: { key: questKey } });
      if (!quest) throw new GameError(GAME_ERROR_CODES.QUEST_NOT_FOUND, 'errors.quests.notFound');
      const { steps } = this.requireDefinition(quest);
      const character = await transaction.character.findUnique({ where: { id: session.characterId }, select: { userId: true, level: true } });
      if (!character || character.userId !== session.userId) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      if (character.level < quest.minimumLevel) throw new GameError(GAME_ERROR_CODES.QUEST_LEVEL_REQUIRED, 'errors.quests.levelRequired');
      const existing = await transaction.characterQuest.findUnique({
        where: { characterId_questDefinitionId: { characterId: session.characterId, questDefinitionId: quest.id } },
      });
      if (existing?.status === 'REWARDED' || existing?.status === 'COMPLETED') throw new GameError(GAME_ERROR_CODES.QUEST_ALREADY_COMPLETED, 'errors.quests.alreadyCompleted');
      if (existing?.status === 'ACTIVE') return { state: 'ACTIVE' as const, started: false };
      const progress = questProgressJson(emptyQuestProgress(steps));
      if (existing) await transaction.characterQuest.update({ where: { id: existing.id }, data: { status: 'ACTIVE', progress, startedAt: new Date(), completedAt: null } });
      else await transaction.characterQuest.create({ data: { characterId: session.characterId, questDefinitionId: quest.id, status: 'ACTIVE', progress, startedAt: new Date() } });
      return { state: 'ACTIVE' as const, started: true };
    });
    if (result.started) {
      this.telemetry.emit('quest_started', {
        userId: session.userId,
        characterId: session.characterId,
        realmId: session.realmId,
      }, { questKey });
    }
    return { questKey, state: result.state, completed: false };
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
      const previousProgress = parseQuestProgress(characterQuest.progress);
      const progress = reconcileQuestProgress(steps, previousProgress, inventoryCounts);
      if (!areQuestStepsComplete(evaluateQuestSteps(steps, progress, inventoryCounts, locale)) || !this.hasConsumableRequirements(inventoryCounts, consumableRequirements(steps))) {
        if (progressChanged(previousProgress, progress)) {
          await transaction.characterQuest.update({ where: { id: characterQuest.id }, data: { progress: questProgressJson(progress) } });
        }
        return { completed: false as const, state: 'ACTIVE' as const };
      }
      const character = await transaction.character.findUnique({ where: { id: session.characterId } });
      if (!character || character.userId !== session.userId) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      const claimed = await transaction.characterQuest.updateMany({
        where: { id: characterQuest.id, status: { in: ['ACTIVE', 'COMPLETED'] } },
        data: { status: 'REWARDED', completedAt: new Date(), progress: questProgressJson(progress) },
      });
      if (claimed.count !== 1) throw new GameError(GAME_ERROR_CODES.QUEST_ALREADY_COMPLETED, 'errors.quests.alreadyCompleted');
      await this.consumeRequiredItems(transaction, items, consumableRequirements(steps));
      const characterClass = character.class as CharacterClass;
      const progression = this.progression.applyExperience(character.level, character.experience, rewards.experience);
      const previousBase = this.progression.calculateBaseStats(characterClass, character.level);
      const nextBase = this.progression.calculateBaseStats(characterClass, progression.level);
      const growth = {
        maxHp: nextBase.maxHp - previousBase.maxHp,
        maxEnergy: nextBase.maxEnergy - previousBase.maxEnergy,
        strength: nextBase.strength - previousBase.strength,
        agility: nextBase.agility - previousBase.agility,
        intelligence: nextBase.intelligence - previousBase.intelligence,
        armor: nextBase.armor - previousBase.armor,
      };
      const maxHp = Math.max(1, character.maxHp + growth.maxHp);
      const maxEnergy = Math.max(0, character.maxEnergy + growth.maxEnergy);
      const capacity = skillsForClass(characterClass).reduce((sum, skill) => sum + skill.maxRank, 0);
      const beforePoints = this.progression.calculateSkillPointBudget(character.level, 0, capacity).earned;
      const afterPoints = this.progression.calculateSkillPointBudget(progression.level, 0, capacity).earned;
      const updated = await transaction.character.update({
        where: { id: character.id },
        data: {
          level: progression.level, experience: progression.experience,
          hp: Math.min(maxHp, Math.max(0, character.hp + Math.max(0, growth.maxHp))), maxHp,
          energy: Math.min(maxEnergy, Math.max(0, character.energy + Math.max(0, growth.maxEnergy))), maxEnergy,
          strength: Math.max(0, character.strength + growth.strength), agility: Math.max(0, character.agility + growth.agility),
          intelligence: Math.max(0, character.intelligence + growth.intelligence), armor: Math.max(0, character.armor + growth.armor),
          silver: { increment: rewards.silver }, stateVersion: { increment: 1 }, lastSavedAt: new Date(),
        },
      });
      if (rewards.silver > 0) await this.writeCurrencyLedger(transaction, characterQuest.id, character.id, rewards.silver, updated.silver, questKey);
      return {
        completed: true as const,
        state: 'REWARDED' as const,
        updated,
        startedAt: characterQuest.startedAt?.getTime(),
        reward: {
          ...rewards,
          experience: progression.appliedExperience,
          levelsGained: progression.levelsGained,
          skillPointsGained: Math.max(0, afterPoints - beforePoints),
        },
      };
    });
    if (!result.completed) return { questKey, state: result.state, completed: false };
    const updated = result.updated;
    Object.assign(session, { level: updated.level, experience: updated.experience, hp: updated.hp, maxHp: updated.maxHp, energy: updated.energy, maxEnergy: updated.maxEnergy, strength: updated.strength, agility: updated.agility, intelligence: updated.intelligence, armor: updated.armor, gold: updated.gold, silver: updated.silver });
    session.stateRevision = Math.max(session.stateRevision + 1, updated.stateVersion);
    session.persistedRevision = Math.max(session.persistedRevision, updated.stateVersion);
    session.dirty = false;
    this.telemetry.emit('quest_completed', {
      userId: session.userId,
      characterId: session.characterId,
      realmId: session.realmId,
    }, {
      questKey,
      ...(result.startedAt ? { durationMs: Math.max(0, Date.now() - result.startedAt) } : {}),
    });
    if (result.reward.silver > 0) {
      this.telemetry.emit('currency_changed', {
        userId: session.userId,
        characterId: session.characterId,
        realmId: session.realmId,
      }, {
        currency: 'SILVER',
        direction: 'CREDIT',
        amount: result.reward.silver,
        reason: 'QUEST_REWARD',
      });
    }
    return { questKey, state: 'REWARDED', completed: true, reward: result.reward, character: { level: updated.level, experience: updated.experience, gold: updated.gold, silver: updated.silver } };
  }

  async recordMobKill(characterId: string, mobDefinitionKey: string): Promise<void> { await this.recordObjective(characterId, (step) => matchesMobStep(step, mobDefinitionKey)); }
  async recordNpcTalk(characterId: string, npcKey: string): Promise<void> { await this.recordObjective(characterId, (step) => step.type === 'TALK_TO_NPC' && step.npcKey === npcKey); }

  private async recordObjective(characterId: string, predicate: (step: QuestStepDefinition) => boolean): Promise<void> {
    const [active, inventoryCounts] = await Promise.all([
      this.prisma.characterQuest.findMany({ where: { characterId, status: 'ACTIVE' }, include: { questDefinition: true } }),
      this.getInventoryCounts(this.prisma, characterId),
    ]);
    for (const quest of active) {
      const steps = this.requireSteps(quest.questDefinition);
      const previous = parseQuestProgress(quest.progress);
      const beforeEvent = reconcileQuestProgress(steps, previous, inventoryCounts);
      const incremented = incrementObjectiveProgress(steps, beforeEvent, predicate);
      const afterEvent = reconcileQuestProgress(steps, incremented, inventoryCounts);
      if (!progressChanged(previous, afterEvent)) continue;
      await this.prisma.characterQuest.update({ where: { id: quest.id }, data: { progress: questProgressJson(afterEvent) } });
    }
  }

  private async normalizeProgress(
    database: PrismaService | Prisma.TransactionClient,
    characterQuestId: string,
    steps: readonly QuestStepDefinition[],
    progress: QuestProgressState,
    inventoryCounts: ReadonlyMap<string, number>,
  ): Promise<QuestProgressState> {
    const reconciled = reconcileQuestProgress(steps, progress, inventoryCounts);
    if (progressChanged(progress, reconciled)) {
      await database.characterQuest.update({ where: { id: characterQuestId }, data: { progress: questProgressJson(reconciled) } });
    }
    return reconciled;
  }

  private toLogEntry(quest: CharacterQuestRecord, progress: QuestProgressState, inventoryCounts: ReadonlyMap<string, number>, locale: SupportedLocale): QuestLogEntryPayload {
    const { steps, rewards } = this.requireDefinition(quest.questDefinition);
    const objectives = evaluateQuestSteps(steps, progress, inventoryCounts, locale);
    const status: QuestLogStatus = quest.status === 'REWARDED' ? 'REWARDED' : quest.status === 'COMPLETED' || areQuestStepsComplete(objectives) ? 'READY' : 'ACTIVE';
    return { key: quest.questDefinition.key, name: quest.questDefinition.name, description: quest.questDefinition.description, status, activeStage: status === 'ACTIVE' ? getActiveQuestStage(steps, progress) : undefined, objectives, rewards, startedAt: quest.startedAt?.getTime(), completedAt: quest.completedAt?.getTime() };
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
  private hasConsumableRequirements(inventoryCounts: ReadonlyMap<string, number>, requirements: ReadonlyMap<string, number>): boolean {
    for (const [itemKey, quantity] of requirements) if ((inventoryCounts.get(itemKey) ?? 0) < quantity) return false;
    return true;
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
  private async writeCurrencyLedger(transaction: Prisma.TransactionClient, characterQuestId: string, characterId: string, amount: number, balanceAfter: number, questKey: string): Promise<void> {
    await transaction.characterCurrencyLedger.create({ data: { characterId, operationId: `quest:${characterQuestId}:silver`, currency: 'SILVER', direction: 'CREDIT', amount, reason: 'QUEST_REWARD', balanceAfter, metadata: { questKey } } });
  }
}
