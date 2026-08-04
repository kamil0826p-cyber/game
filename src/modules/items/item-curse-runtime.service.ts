import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
} from './itemization.rules.js';
import type { ItemInstanceSnapshot } from './itemization.types.js';

export type ItemCorruptionTrigger = 'SKILL_CAST' | 'GUARD_SUCCESS' | 'COMBAT_END';

export interface EquippedItemCurseModifiers {
  healingReceivedMultiplier: number;
  healingConsumablesLocked: boolean;
  corruptionByTrigger: Record<ItemCorruptionTrigger, number>;
}

type CorruptionWriter = (
  characterId: string,
  amount: number,
  operationId: string,
) => Promise<number>;

const modifiersByCharacterId = new Map<string, EquippedItemCurseModifiers>();
const corruptionWrites = new Map<string, Promise<void>>();
let corruptionWriter: CorruptionWriter | undefined;

const emptyModifiers = (): EquippedItemCurseModifiers => ({
  healingReceivedMultiplier: 1,
  healingConsumablesLocked: false,
  corruptionByTrigger: {
    SKILL_CAST: 0,
    GUARD_SUCCESS: 0,
    COMBAT_END: 0,
  },
});

const cloneModifiers = (
  value: EquippedItemCurseModifiers,
): EquippedItemCurseModifiers => ({
  healingReceivedMultiplier: value.healingReceivedMultiplier,
  healingConsumablesLocked: value.healingConsumablesLocked,
  corruptionByTrigger: { ...value.corruptionByTrigger },
});

const record = (value: Prisma.JsonValue): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const itemCurseModifiersFromSnapshots = (
  snapshots: readonly ItemInstanceSnapshot[],
): EquippedItemCurseModifiers => {
  const result = emptyModifiers();
  for (const snapshot of snapshots) {
    const cost = snapshot.curse?.cost;
    if (!cost) continue;
    switch (cost.type) {
      case 'HEALING_RECEIVED_MULTIPLIER':
        result.healingReceivedMultiplier *= Math.max(0, Math.min(1, cost.multiplier));
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
    Math.max(0, Math.min(1, result.healingReceivedMultiplier)).toFixed(4),
  );
  return result;
};

export const cacheEquippedItemCurseModifiers = (
  characterId: string,
  modifiers: EquippedItemCurseModifiers,
): void => {
  modifiersByCharacterId.set(characterId, cloneModifiers(modifiers));
};

export const cachedEquippedItemCurseModifiers = (
  characterId: string | undefined,
): EquippedItemCurseModifiers =>
  characterId
    ? cloneModifiers(modifiersByCharacterId.get(characterId) ?? emptyModifiers())
    : emptyModifiers();

export const queueItemCurseCorruption = (
  characterId: string | undefined,
  amount: number,
  operationId: string,
): void => {
  const normalizedAmount = Math.max(0, Math.trunc(amount));
  if (!characterId || normalizedAmount === 0 || !corruptionWriter) return;
  const previous = corruptionWrites.get(characterId) ?? Promise.resolve();
  let write!: Promise<void>;
  write = previous
    .catch(() => undefined)
    .then(async () => {
      const writer = corruptionWriter;
      if (!writer) return;
      try {
        await writer(characterId, normalizedAmount, operationId);
      } catch {
        await writer(characterId, normalizedAmount, operationId).catch(() => undefined);
      }
    })
    .finally(() => {
      if (corruptionWrites.get(characterId) === write) corruptionWrites.delete(characterId);
    });
  corruptionWrites.set(characterId, write);
};

export const drainItemCurseCorruptionWrites = async (): Promise<void> => {
  await Promise.allSettled([...corruptionWrites.values()]);
};

@Injectable()
export class ItemCurseRuntimeService implements OnModuleDestroy {
  constructor(private readonly database: PrismaService) {
    corruptionWriter = (characterId, amount, operationId) =>
      this.persistCorruption(characterId, amount, operationId);
  }

  async onModuleDestroy(): Promise<void> {
    await drainItemCurseCorruptionWrites();
  }

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
    const snapshots = rows.map((row) => {
      const metadata = parseItemDefinitionMetadata(row.itemDefinition.metadata);
      return readItemInstanceSnapshot({
        instanceData: row.instanceData,
        definitionKey: row.itemDefinition.key,
        metadata,
      });
    });
    const result = itemCurseModifiersFromSnapshots(snapshots);
    cacheEquippedItemCurseModifiers(characterId, result);
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
