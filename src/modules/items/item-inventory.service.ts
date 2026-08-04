import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  itemStackKey,
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
  writeItemInstanceData,
} from './itemization.rules.js';
import type { ItemInstanceSnapshot } from './itemization.types.js';

export const ITEM_INVENTORY_CAPACITY = 40;
export const ITEM_CLAIM_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface InventoryGrantResult {
  grantedQuantity: number;
  claimedQuantity: number;
  inventoryItemIds: string[];
  claimIds: string[];
}

export interface ConsumedInventoryInput {
  itemDefinitionId: string;
  itemKey: string;
  quantity: number;
}

type ItemDefinitionRecord = {
  id: string;
  key: string;
  stackLimit: number;
  metadata: Prisma.JsonValue;
};

@Injectable()
export class ItemInventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async grant(
    transaction: Prisma.TransactionClient,
    input: {
      characterId: string;
      definition: ItemDefinitionRecord;
      quantity: number;
      snapshot: ItemInstanceSnapshot;
      operationId: string;
      reason: string;
      claimOverflow?: boolean;
    },
  ): Promise<InventoryGrantResult> {
    this.assertQuantity(input.quantity);
    const metadata = parseItemDefinitionMetadata(input.definition.metadata);
    const stackKey = itemStackKey(input.definition.key, metadata, input.snapshot);
    const inventoryItemIds: string[] = [];
    const claimIds: string[] = [];
    let remaining = input.quantity;

    const items = await transaction.inventoryItem.findMany({
      where: { characterId: input.characterId },
      include: {
        itemDefinition: true,
        tradeOfferItems: { select: { id: true } },
      },
      orderBy: { slotIndex: 'asc' },
    });
    const occupied = new Set(items.map((item) => item.slotIndex));

    if (input.definition.stackLimit > 1 && metadata.category !== 'EQUIPMENT') {
      for (const stack of items) {
        if (
          remaining <= 0 ||
          stack.itemDefinitionId !== input.definition.id ||
          stack.equippedSlot ||
          stack.tradeOfferItems.length > 0 ||
          stack.quantity >= input.definition.stackLimit
        ) {
          continue;
        }
        const stackMetadata = parseItemDefinitionMetadata(stack.itemDefinition.metadata);
        const stackSnapshot = readItemInstanceSnapshot({
          instanceData: stack.instanceData,
          definitionKey: stack.itemDefinition.key,
          metadata: stackMetadata,
        });
        if (itemStackKey(stack.itemDefinition.key, stackMetadata, stackSnapshot) !== stackKey) continue;
        const moved = Math.min(remaining, input.definition.stackLimit - stack.quantity);
        await transaction.inventoryItem.update({
          where: { id: stack.id },
          data: { quantity: { increment: moved } },
        });
        remaining -= moved;
        inventoryItemIds.push(stack.id);
      }
    }

    for (let slotIndex = 0; slotIndex < ITEM_INVENTORY_CAPACITY && remaining > 0; slotIndex += 1) {
      if (occupied.has(slotIndex)) continue;
      const amount = Math.min(remaining, input.definition.stackLimit);
      const created = await transaction.inventoryItem.create({
        data: {
          characterId: input.characterId,
          itemDefinitionId: input.definition.id,
          quantity: amount,
          slotIndex,
          instanceData: writeItemInstanceData(undefined, input.snapshot),
        },
      });
      occupied.add(slotIndex);
      remaining -= amount;
      inventoryItemIds.push(created.id);
    }

    const grantedQuantity = input.quantity - remaining;
    if (grantedQuantity > 0) {
      await this.recordEvent(transaction, {
        characterId: input.characterId,
        operationId: this.eventOperation(input.operationId, input.definition.key),
        eventType: 'ITEM_ACQUIRED',
        itemDefinitionKey: input.definition.key,
        quantity: grantedQuantity,
        metadata: { reason: input.reason, snapshotHash: stackKey },
      });
    }

    if (remaining > 0) {
      if (input.claimOverflow === false) {
        throw new GameError(GAME_ERROR_CODES.INVENTORY_FULL, 'errors.items.inventoryFull');
      }
      const claimOperationId = this.eventOperation(
        `${input.operationId}:claim`,
        input.definition.key,
      );
      const claim = await transaction.itemClaim.upsert({
        where: {
          characterId_operationId: {
            characterId: input.characterId,
            operationId: claimOperationId,
          },
        },
        create: {
          characterId: input.characterId,
          itemDefinitionId: input.definition.id,
          quantity: remaining,
          instanceData: writeItemInstanceData(undefined, input.snapshot),
          reason: input.reason,
          operationId: claimOperationId,
          expiresAt: new Date(Date.now() + ITEM_CLAIM_TTL_MS),
        },
        update: {},
      });
      claimIds.push(claim.id);
      await this.recordEvent(transaction, {
        characterId: input.characterId,
        operationId: claimOperationId,
        eventType: 'CLAIM_CREATED',
        itemDefinitionKey: input.definition.key,
        quantity: remaining,
        metadata: { reason: input.reason, expiresAt: claim.expiresAt.toISOString() },
      });
    }

    return {
      grantedQuantity,
      claimedQuantity: remaining,
      inventoryItemIds: [...new Set(inventoryItemIds)],
      claimIds,
    };
  }

  async consumeByDefinitionKeys(
    transaction: Prisma.TransactionClient,
    characterId: string,
    requirements: readonly { itemKey: string; quantity: number }[],
  ): Promise<ConsumedInventoryInput[]> {
    const normalized = requirements.map((requirement) => ({
      itemKey: requirement.itemKey,
      quantity: this.normalizedQuantity(requirement.quantity),
    }));
    const definitions = await transaction.itemDefinition.findMany({
      where: { key: { in: normalized.map((requirement) => requirement.itemKey) } },
      select: { id: true, key: true },
    });
    const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
    if (byKey.size !== new Set(normalized.map((requirement) => requirement.itemKey)).size) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }

    const consumed: ConsumedInventoryInput[] = [];
    for (const requirement of normalized) {
      const definition = byKey.get(requirement.itemKey)!;
      const stacks = await transaction.inventoryItem.findMany({
        where: {
          characterId,
          itemDefinitionId: definition.id,
          equippedSlot: null,
          tradeOfferItems: { none: {} },
        },
        orderBy: [{ quantity: 'asc' }, { slotIndex: 'asc' }],
      });
      const available = stacks.reduce((sum, stack) => sum + stack.quantity, 0);
      if (available < requirement.quantity) {
        throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
          itemKey: requirement.itemKey,
          required: requirement.quantity,
          available,
        });
      }
      let remaining = requirement.quantity;
      for (const stack of stacks) {
        if (remaining <= 0) break;
        const amount = Math.min(remaining, stack.quantity);
        if (amount === stack.quantity) {
          await transaction.inventoryItem.delete({ where: { id: stack.id } });
        } else {
          await transaction.inventoryItem.update({
            where: { id: stack.id },
            data: { quantity: { decrement: amount } },
          });
        }
        remaining -= amount;
      }
      consumed.push({
        itemDefinitionId: definition.id,
        itemKey: definition.key,
        quantity: requirement.quantity,
      });
    }
    return consumed;
  }

  async removeOwnedItem(
    transaction: Prisma.TransactionClient,
    input: { characterId: string; itemId: string; quantity: number },
  ) {
    this.assertQuantity(input.quantity);
    const item = await transaction.inventoryItem.findFirst({
      where: {
        id: input.itemId,
        characterId: input.characterId,
        tradeOfferItems: { none: {} },
      },
      include: { itemDefinition: true },
    });
    if (!item || item.equippedSlot || item.quantity < input.quantity) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    const instanceData: Prisma.JsonValue & Prisma.InputJsonValue = item.instanceData === null
      ? {}
      : (item.instanceData as Prisma.JsonValue & Prisma.InputJsonValue);
    if (input.quantity === item.quantity) {
      await transaction.inventoryItem.delete({ where: { id: item.id } });
    } else {
      await transaction.inventoryItem.update({
        where: { id: item.id },
        data: { quantity: { decrement: input.quantity } },
      });
    }
    return { ...item, instanceData };
  }

  async claim(
    transaction: Prisma.TransactionClient,
    input: { characterId: string; claimId: string; operationId: string },
  ): Promise<InventoryGrantResult> {
    const claim = await transaction.itemClaim.findFirst({
      where: { id: input.claimId, characterId: input.characterId },
    });
    if (!claim || claim.status !== 'OPEN') {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
    if (claim.expiresAt.getTime() <= Date.now()) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
        claimId: claim.id,
        reason: 'REWARD_CLAIM_EXPIRED',
      });
    }
    const definition = await transaction.itemDefinition.findUniqueOrThrow({
      where: { id: claim.itemDefinitionId },
    });
    const metadata = parseItemDefinitionMetadata(definition.metadata);
    const snapshot = readItemInstanceSnapshot({
      instanceData: claim.instanceData,
      definitionKey: definition.key,
      metadata,
    });
    const result = await this.grant(transaction, {
      characterId: input.characterId,
      definition,
      quantity: claim.quantity,
      snapshot,
      operationId: input.operationId,
      reason: `CLAIM:${claim.reason}`,
      claimOverflow: false,
    });
    await transaction.itemClaim.update({
      where: { id: claim.id },
      data: { status: 'CLAIMED', claimedAt: new Date() },
    });
    await this.recordEvent(transaction, {
      characterId: input.characterId,
      operationId: this.eventOperation(input.operationId, claim.id),
      eventType: 'CLAIM_COLLECTED',
      itemDefinitionKey: definition.key,
      quantity: claim.quantity,
      metadata: { claimId: claim.id },
    });
    return result;
  }

  async listOpenClaims(characterId: string) {
    return this.prisma.itemClaim.findMany({
      where: {
        characterId,
        status: 'OPEN',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async recordEvent(
    transaction: Prisma.TransactionClient,
    input: {
      characterId: string;
      operationId: string;
      eventType: string;
      itemDefinitionKey?: string;
      inventoryItemId?: string;
      quantity?: number;
      silverDelta?: number;
      metadata?: unknown;
    },
  ): Promise<void> {
    await transaction.itemEconomyEvent.create({
      data: {
        characterId: input.characterId,
        operationId: input.operationId.slice(0, 128),
        eventType: input.eventType.slice(0, 64),
        itemDefinitionKey: input.itemDefinitionKey,
        inventoryItemId: input.inventoryItemId,
        quantity: input.quantity ?? 0,
        silverDelta: input.silverDelta ?? 0,
        metadata: this.json(input.metadata ?? {}),
      },
    });
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private eventOperation(operationId: string, suffix: string): string {
    const hash = Buffer.from(suffix).toString('base64url').slice(0, 24);
    return `${operationId}:${hash}`.slice(0, 128);
  }

  private normalizedQuantity(quantity: number): number {
    this.assertQuantity(quantity);
    return Math.trunc(quantity);
  }

  private assertQuantity(quantity: number): void {
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid');
    }
  }
}
