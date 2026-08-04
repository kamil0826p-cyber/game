import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
} from './itemization.rules.js';

export type ItemCorruptionTrigger = 'SKILL_CAST' | 'GUARD_SUCCESS' | 'COMBAT_END';

export interface EquippedItemCurseModifiers {
  healingReceivedMultiplier: number;
  healingConsumablesLocked: boolean;
  corruptionByTrigger: Record<ItemCorruptionTrigger, number>;
}

const emptyModifiers = (): EquippedItemCurseModifiers => ({
  healingReceivedMultiplier: 1,
  healingConsumablesLocked: false,
  corruptionByTrigger: {
    SKILL_CAST: 0,
    GUARD_SUCCESS: 0,
    COMBAT_END: 0,
  },
});

const record = (value: Prisma.JsonValue): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

@Injectable()
export class ItemCurseRuntimeService {
  constructor(private readonly database: PrismaService) {}

  async getEquippedModifiers(
    userId: string,
    characterId: string,
  ): Promise<EquippedItemCurseModifiers> {
    const rows = await this.database.inventoryItem.findMany({
      where: {
        characterId,
        equippedSlot: { not: null },
        character: { userId },
      },
      include: { itemDefinition: true },
    });
    const result = emptyModifiers();
    for (const row of rows) {
      const metadata = parseItemDefinitionMetadata(row.itemDefinition.metadata);
      const snapshot = readItemInstanceSnapshot({
        instanceData: row.instanceData,
        definitionKey: row.itemDefinition.key,
        metadata,
      });
      const cost = snapshot.curse?.cost;
      if (!cost) continue;
      switch (cost.type) {
        case 'HEALING_RECEIVED_MULTIPLIER':
          result.healingReceivedMultiplier *= Math.max(0, cost.multiplier);
          break;
        case 'CONSUMABLE_LOCK':
          if (cost.category === 'HEALING') result.healingConsumablesLocked = true;
          break;
        case 'CORRUPTION_ON_TRIGGER':
          result.corruptionByTrigger[cost.trigger] += Math.max(0, Math.trunc(cost.amount));
          break;
        case 'STAT_PENALTY':
          break;
      }
    }
    result.healingReceivedMultiplier = Number(
      Math.max(0, result.healingReceivedMultiplier).toFixed(4),
    );
    return result;
  }

  async assertHealingConsumableAllowed(
    userId: string,
    characterId: string,
    itemId: string,
  ): Promise<void> {
    const item = await this.database.inventoryItem.findFirst({
      where: { id: itemId, characterId, character: { userId } },
      include: { itemDefinition: true },
    });
    if (!item) return;
    const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
    if (metadata.category !== 'CONSUMABLE' || (metadata.effect?.hp ?? 0) <= 0) return;
    const modifiers = await this.getEquippedModifiers(userId, characterId);
    if (!modifiers.healingConsumablesLocked) return;
    throw new GameError(
      GAME_ERROR_CODES.ITEM_CURSE_RESTRICTION,
      'errors.items.curseRestriction',
      { reason: 'HEALING_CONSUMABLE_LOCKED' },
    );
  }

  async persistCorruption(
    characterId: string,
    amount: number,
    operationId: string,
  ): Promise<number> {
    const normalizedAmount = Math.max(0, Math.min(2_147_483_647, Math.trunc(amount)));
    if (normalizedAmount === 0) return 0;
    const normalizedOperationId = operationId.slice(0, 128);
    try {
      return await this.database.$transaction(async (transaction) => {
        const existing = await transaction.itemEconomyEvent.findFirst({
          where: {
            characterId,
            operationId: normalizedOperationId,
            eventType: 'ITEM_CURSE_CORRUPTION',
          },
          select: { id: true },
        });
        if (existing) return 0;
        const character = await transaction.character.findUnique({
          where: { id: characterId },
          select: { progressionData: true },
        });
        if (!character) return 0;
        const progression = record(character.progressionData);
        const current =
          typeof progression.corruption === 'number' &&
          Number.isFinite(progression.corruption)
            ? Math.max(0, Math.trunc(progression.corruption))
            : 0;
        const next = Math.min(2_147_483_647, current + normalizedAmount);
        await transaction.character.update({
          where: { id: characterId },
          data: {
            progressionData: {
              ...progression,
              corruption: next,
            } as Prisma.InputJsonValue,
            lastSavedAt: new Date(),
          },
        });
        await transaction.itemEconomyEvent.create({
          data: {
            characterId,
            operationId: normalizedOperationId,
            eventType: 'ITEM_CURSE_CORRUPTION',
            quantity: normalizedAmount,
            silverDelta: 0,
            metadata: {
              amount: normalizedAmount,
              corruptionBefore: current,
              corruptionAfter: next,
            } as Prisma.InputJsonValue,
          },
        });
        return normalizedAmount;
      });
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code?: unknown }).code === 'P2002'
      ) {
        return 0;
      }
      throw error;
    }
  }
}
