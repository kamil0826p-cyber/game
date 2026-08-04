import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ItemInventoryService } from './item-inventory.service.js';
import { ITEM_RECIPES } from './itemization.catalog.js';
import {
  createItemInstanceSnapshot,
  parseItemDefinitionMetadata,
} from './itemization.rules.js';
import type {
  ItemOriginSnapshot,
  ItemRecipeDefinition,
} from './itemization.types.js';

export const CRAFT_ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CRAFT_ORDER_ACTIVE_LIMIT = 10;
export const CRAFT_ORDER_MAX_REWARD_SILVER = 10_000_000;

type OrderResolution = 'COMPLETED' | 'EXPIRED';

export interface CraftOrderFulfillmentResult {
  orderId: string;
  ownerCharacterId: string;
  outputItemKey: string;
  rewardSilver: number;
  crafterSilver: number;
  delivery: 'INVENTORY' | 'CLAIMS';
}

@Injectable()
export class CraftOrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: ItemInventoryService,
  ) {}

  async create(
    userId: string,
    characterId: string,
    recipeKey: string,
    rewardSilver: number,
    operationId: string,
  ): Promise<string> {
    const recipe = this.requireRecipe(recipeKey);
    const reward = this.normalizedReward(rewardSilver);
    const normalizedOperationId = this.operationId(operationId);
    return this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const existing = await transaction.itemCraftOrder.findUnique({
        where: {
          ownerCharacterId_operationId: {
            ownerCharacterId: characterId,
            operationId: normalizedOperationId,
          },
        },
      });
      if (existing) {
        if (
          existing.recipeKey !== recipe.key ||
          existing.recipeVersion !== recipe.version ||
          this.rewardSilver(existing.silverEscrow, recipe) !== reward
        ) {
          this.invalid({ reason: 'OPERATION_ID_REUSED' });
        }
        return existing.id;
      }

      const character = await this.requireCharacter(transaction, userId, characterId);
      this.assertRegionAccess(character, recipe);
      const activeOrders = await transaction.itemCraftOrder.count({
        where: {
          ownerCharacterId: characterId,
          status: 'OPEN',
          expiresAt: { gt: new Date() },
        },
      });
      if (activeOrders >= CRAFT_ORDER_ACTIVE_LIMIT) {
        this.invalid({
          reason: 'CRAFT_ORDER_LIMIT_REACHED',
          activeOrders,
          limit: CRAFT_ORDER_ACTIVE_LIMIT,
        });
      }

      const output = await transaction.itemDefinition.findUnique({
        where: { key: recipe.outputItemKey },
      });
      if (!output) this.invalid({ recipeKey, reason: 'OUTPUT_DEFINITION_MISSING' });
      const escrow = await this.inventory.consumeByDefinitionKeys(
        transaction,
        characterId,
        recipe.inputs,
      );
      const totalEscrowSilver = recipe.silverCost + reward;
      const nextSilver = this.debitSilver(character.silver, totalEscrowSilver);
      await transaction.character.update({
        where: { id: characterId },
        data: { silver: nextSilver },
      });
      await transaction.characterCurrencyLedger.create({
        data: {
          characterId,
          operationId: `craft-order:${normalizedOperationId}`,
          currency: 'SILVER',
          direction: 'DEBIT',
          amount: totalEscrowSilver,
          reason: 'ITEM_CRAFT_ESCROW',
          balanceAfter: nextSilver,
          metadata: {
            recipeKey: recipe.key,
            recipeVersion: recipe.version,
            craftCostSilver: recipe.silverCost,
            rewardSilver: reward,
          },
        },
      });
      const order = await transaction.itemCraftOrder.create({
        data: {
          ownerCharacterId: characterId,
          recipeKey: recipe.key,
          recipeVersion: recipe.version,
          silverEscrow: totalEscrowSilver,
          inputEscrow: this.json(escrow),
          outputItemDefinitionId: output.id,
          outputQuantity: recipe.outputQuantity,
          operationId: normalizedOperationId,
          expiresAt: new Date(Date.now() + CRAFT_ORDER_TTL_MS),
        },
      });
      await this.inventory.recordEvent(transaction, {
        characterId,
        operationId: normalizedOperationId,
        eventType: 'CRAFT_ORDER_OPENED',
        itemDefinitionKey: output.key,
        quantity: recipe.outputQuantity,
        silverDelta: -totalEscrowSilver,
        metadata: {
          orderId: order.id,
          recipeKey: recipe.key,
          inputEscrow: escrow,
          craftCostSilver: recipe.silverCost,
          rewardSilver: reward,
        },
      });
      return order.id;
    });
  }

  async fulfill(
    userId: string,
    crafterCharacterId: string,
    orderId: string,
    operationId: string,
  ): Promise<CraftOrderFulfillmentResult> {
    const normalizedOperationId = this.operationId(operationId);
    const resolution = await this.prisma.$transaction<
      { type: 'COMPLETED'; value: CraftOrderFulfillmentResult } | { type: 'EXPIRED' }
    >(async (transaction) => {
      await this.lockOperation(transaction, `craft-order:${orderId}`);
      const repeated = await transaction.itemEconomyEvent.findUnique({
        where: {
          characterId_operationId_eventType: {
            characterId: crafterCharacterId,
            operationId: normalizedOperationId,
            eventType: 'CRAFT_ORDER_FULFILLED',
          },
        },
      });
      if (repeated) {
        if (this.metadataString(repeated.metadata, 'orderId') !== orderId) {
          this.invalid({ reason: 'OPERATION_ID_REUSED' });
        }
        const crafter = await this.requireCharacter(
          transaction,
          userId,
          crafterCharacterId,
        );
        return {
          type: 'COMPLETED',
          value: {
            orderId,
            ownerCharacterId:
              this.metadataString(repeated.metadata, 'ownerCharacterId') ?? '',
            outputItemKey: repeated.itemDefinitionKey ?? '',
            rewardSilver: this.metadataNumber(repeated.metadata, 'rewardSilver') ?? 0,
            crafterSilver: crafter.silver,
            delivery:
              this.metadataString(repeated.metadata, 'delivery') === 'CLAIMS'
                ? 'CLAIMS'
                : 'INVENTORY',
          },
        };
      }

      const order = await transaction.itemCraftOrder.findUnique({ where: { id: orderId } });
      if (!order || order.status !== 'OPEN') this.invalid({ orderId });
      if (order.ownerCharacterId === crafterCharacterId) {
        this.invalid({ orderId, reason: 'CRAFT_ORDER_SELF_FULFILL' });
      }
      if (order.expiresAt.getTime() <= Date.now()) {
        await this.lockCharacter(transaction, order.ownerCharacterId);
        await this.refundOrder(transaction, order, 'EXPIRED');
        return { type: 'EXPIRED' };
      }

      await this.lockCharacters(transaction, [order.ownerCharacterId, crafterCharacterId]);
      const crafter = await this.requireCharacter(
        transaction,
        userId,
        crafterCharacterId,
      );
      const owner = await transaction.character.findUnique({
        where: { id: order.ownerCharacterId },
        select: { id: true, realmId: true },
      });
      if (!owner) this.invalid({ orderId, reason: 'CRAFT_ORDER_OWNER_MISSING' });
      if (owner.realmId !== crafter.realmId) {
        this.invalid({ orderId, reason: 'CRAFT_ORDER_REALM_MISMATCH' });
      }

      const recipe = this.requireRecipe(order.recipeKey);
      if (recipe.version !== order.recipeVersion) {
        this.invalid({ orderId, reason: 'RECIPE_VERSION_MISMATCH' });
      }
      this.assertCrafterAccess(crafter, recipe);
      const output = await transaction.itemDefinition.findUniqueOrThrow({
        where: { id: order.outputItemDefinitionId },
      });
      const metadata = parseItemDefinitionMetadata(output.metadata);
      const snapshot = createItemInstanceSnapshot({
        definitionKey: output.key,
        metadata,
        seed: `${recipe.deterministicSeedSalt}:${order.ownerCharacterId}:${normalizedOperationId}`,
        craftQuality: 70,
        origin: this.origin({
          source: 'CRAFT',
          sourceKey: recipe.key,
          operationId: normalizedOperationId,
          recipeKey: recipe.key,
          recipeVersion: recipe.version,
          crafterCharacterId,
        }),
      });
      const grant = await this.inventory.grant(transaction, {
        characterId: order.ownerCharacterId,
        definition: output,
        quantity: order.outputQuantity,
        snapshot,
        operationId: `craft-order-output:${order.id}`,
        reason: `CRAFT_ORDER:${order.id}`,
      });
      const delivery = grant.claimedQuantity > 0 ? 'CLAIMS' : 'INVENTORY';
      const reward = this.rewardSilver(order.silverEscrow, recipe);
      const crafterSilver = crafter.silver + reward;
      if (reward > 0) {
        await transaction.character.update({
          where: { id: crafterCharacterId },
          data: { silver: crafterSilver },
        });
        await transaction.characterCurrencyLedger.create({
          data: {
            characterId: crafterCharacterId,
            operationId: `craft-order-reward:${order.id}`,
            currency: 'SILVER',
            direction: 'CREDIT',
            amount: reward,
            reason: 'ITEM_CRAFT_REWARD',
            balanceAfter: crafterSilver,
            metadata: {
              orderId: order.id,
              ownerCharacterId: order.ownerCharacterId,
              recipeKey: recipe.key,
            },
          },
        });
      }
      await transaction.itemCraftOrder.update({
        where: { id: order.id },
        data: {
          status: 'COMPLETED',
          crafterCharacterId,
          completedAt: new Date(),
        },
      });
      await this.inventory.recordEvent(transaction, {
        characterId: order.ownerCharacterId,
        operationId: `craft-order-complete:${order.id}`,
        eventType: 'CRAFT_ORDER_COMPLETED',
        itemDefinitionKey: output.key,
        quantity: order.outputQuantity,
        metadata: {
          orderId: order.id,
          recipeKey: recipe.key,
          crafterCharacterId,
          craftCostSilver: recipe.silverCost,
          rewardSilver: reward,
          delivery,
        },
      });
      await this.inventory.recordEvent(transaction, {
        characterId: crafterCharacterId,
        operationId: normalizedOperationId,
        eventType: 'CRAFT_ORDER_FULFILLED',
        itemDefinitionKey: output.key,
        quantity: order.outputQuantity,
        silverDelta: reward,
        metadata: {
          orderId: order.id,
          ownerCharacterId: order.ownerCharacterId,
          rewardSilver: reward,
          delivery,
        },
      });
      return {
        type: 'COMPLETED',
        value: {
          orderId: order.id,
          ownerCharacterId: order.ownerCharacterId,
          outputItemKey: output.key,
          rewardSilver: reward,
          crafterSilver,
          delivery,
        },
      };
    });
    if (resolution.type === 'EXPIRED') {
      throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
        orderId,
        reason: 'ORDER_EXPIRED_REFUNDED',
      });
    }
    return resolution.value;
  }

  async cancel(
    userId: string,
    characterId: string,
    orderId: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockOperation(transaction, `craft-order:${orderId}`);
      await this.lockCharacter(transaction, characterId);
      await this.requireCharacter(transaction, userId, characterId);
      const order = await transaction.itemCraftOrder.findFirst({
        where: { id: orderId, ownerCharacterId: characterId },
      });
      if (!order) this.invalid({ orderId });
      if (order.status === 'CANCELLED' || order.status === 'EXPIRED') return;
      if (order.status !== 'OPEN') this.invalid({ orderId });
      await this.refundOrder(transaction, order, 'CANCELLED');
    });
  }

  async expireOrders(limit = 100): Promise<number> {
    const orders = await this.prisma.itemCraftOrder.findMany({
      where: { status: 'OPEN', expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: this.boundedLimit(limit),
    });
    let expired = 0;
    for (const order of orders) {
      const changed = await this.prisma.$transaction(async (transaction) => {
        await this.lockOperation(transaction, `craft-order:${order.id}`);
        const current = await transaction.itemCraftOrder.findUnique({ where: { id: order.id } });
        if (
          !current ||
          current.status !== 'OPEN' ||
          current.expiresAt.getTime() > Date.now()
        ) {
          return false;
        }
        await this.lockCharacter(transaction, current.ownerCharacterId);
        await this.refundOrder(transaction, current, 'EXPIRED');
        return true;
      });
      if (changed) expired += 1;
    }
    return expired;
  }

  rewardForEscrow(totalEscrowSilver: number, recipeKey: string): number {
    return this.rewardSilver(totalEscrowSilver, this.requireRecipe(recipeKey));
  }

  private async refundOrder(
    transaction: Prisma.TransactionClient,
    order: {
      id: string;
      ownerCharacterId: string;
      recipeKey: string;
      recipeVersion: number;
      silverEscrow: number;
      inputEscrow: Prisma.JsonValue;
    },
    status: 'CANCELLED' | 'EXPIRED',
  ): Promise<void> {
    const escrow = this.readEscrow(order.inputEscrow);
    const definitions = await transaction.itemDefinition.findMany({
      where: { id: { in: escrow.map((input) => input.itemDefinitionId) } },
    });
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    for (const input of escrow) {
      const definition = byId.get(input.itemDefinitionId);
      if (!definition) throw new Error('CRAFT_ESCROW_DEFINITION_MISSING');
      const metadata = parseItemDefinitionMetadata(definition.metadata);
      const snapshot = createItemInstanceSnapshot({
        definitionKey: definition.key,
        metadata,
        seed: `craft-refund:${order.id}:${definition.key}`,
        origin: this.origin({
          source: 'CRAFT',
          sourceKey: `refund:${order.recipeKey}`,
          operationId: `refund:${order.id}:${definition.key}`,
          recipeKey: order.recipeKey,
          recipeVersion: order.recipeVersion,
        }),
      });
      await this.inventory.grant(transaction, {
        characterId: order.ownerCharacterId,
        definition,
        quantity: input.quantity,
        snapshot,
        operationId: `craft-refund:${order.id}:${definition.key}`,
        reason: `CRAFT_ORDER_${status}`,
      });
    }
    const owner = await transaction.character.findUniqueOrThrow({
      where: { id: order.ownerCharacterId },
      select: { silver: true },
    });
    const nextSilver = owner.silver + order.silverEscrow;
    await transaction.character.update({
      where: { id: order.ownerCharacterId },
      data: { silver: nextSilver },
    });
    if (order.silverEscrow > 0) {
      await transaction.characterCurrencyLedger.create({
        data: {
          characterId: order.ownerCharacterId,
          operationId: `craft-order-refund:${order.id}`,
          currency: 'SILVER',
          direction: 'CREDIT',
          amount: order.silverEscrow,
          reason: 'ITEM_CRAFT_ESCROW_REFUND',
          balanceAfter: nextSilver,
          metadata: { orderId: order.id, status },
        },
      });
    }
    await transaction.itemCraftOrder.update({
      where: { id: order.id },
      data: {
        status,
        cancelledAt: new Date(),
      },
    });
    await this.inventory.recordEvent(transaction, {
      characterId: order.ownerCharacterId,
      operationId: `craft-order-${status.toLowerCase()}:${order.id}`,
      eventType: `CRAFT_ORDER_${status}`,
      quantity: 0,
      silverDelta: order.silverEscrow,
      metadata: { orderId: order.id, refundedInputs: escrow },
    });
  }

  private requireRecipe(recipeKey: string): ItemRecipeDefinition {
    const recipe = ITEM_RECIPES[recipeKey];
    if (!recipe) this.invalid({ recipeKey });
    return recipe;
  }

  private async requireCharacter(
    transaction: Prisma.TransactionClient,
    userId: string,
    characterId: string,
  ) {
    const character = await transaction.character.findFirst({
      where: { id: characterId, userId },
      select: {
        id: true,
        realmId: true,
        level: true,
        silver: true,
        map: { select: { key: true } },
      },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    return character;
  }

  private assertRegionAccess(
    character: { map: { key: string } },
    recipe: ItemRecipeDefinition,
  ): void {
    if (recipe.regionKey && character.map.key !== recipe.regionKey) {
      this.invalid({ recipeKey: recipe.key, requiredRegion: recipe.regionKey });
    }
  }

  private assertCrafterAccess(
    character: { level: number; map: { key: string } },
    recipe: ItemRecipeDefinition,
  ): void {
    if (character.level < recipe.requiredLevel) {
      this.invalid({ recipeKey: recipe.key, requiredLevel: recipe.requiredLevel });
    }
    this.assertRegionAccess(character, recipe);
  }

  private rewardSilver(totalEscrowSilver: number, recipe: ItemRecipeDefinition): number {
    return Math.max(0, totalEscrowSilver - recipe.silverCost);
  }

  private normalizedReward(value: number): number {
    if (
      !Number.isInteger(value) ||
      value < 0 ||
      value > CRAFT_ORDER_MAX_REWARD_SILVER
    ) {
      this.invalid({
        reason: 'CRAFT_ORDER_REWARD_INVALID',
        maximum: CRAFT_ORDER_MAX_REWARD_SILVER,
      });
    }
    return value;
  }

  private operationId(value: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 96) this.invalid({ reason: 'OPERATION_ID_INVALID' });
    return normalized;
  }

  private debitSilver(balance: number, amount: number): number {
    if (balance < amount) {
      throw new GameError(
        GAME_ERROR_CODES.INSUFFICIENT_SILVER,
        'errors.items.insufficientSilver',
      );
    }
    return balance - amount;
  }

  private readEscrow(value: Prisma.JsonValue): Array<{
    itemDefinitionId: string;
    itemKey: string;
    quantity: number;
  }> {
    if (!Array.isArray(value)) throw new Error('CRAFT_ESCROW_INVALID');
    return value.map((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        throw new Error('CRAFT_ESCROW_INVALID');
      }
      const input = entry as Record<string, unknown>;
      if (
        typeof input.itemDefinitionId !== 'string' ||
        typeof input.itemKey !== 'string' ||
        typeof input.quantity !== 'number' ||
        !Number.isInteger(input.quantity) ||
        input.quantity < 1
      ) {
        throw new Error('CRAFT_ESCROW_INVALID');
      }
      return {
        itemDefinitionId: input.itemDefinitionId,
        itemKey: input.itemKey,
        quantity: input.quantity,
      };
    });
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
  }

  private origin(
    input: Omit<ItemOriginSnapshot, 'contentVersion' | 'generatedAt'>,
  ): ItemOriginSnapshot {
    return { ...input, contentVersion: 1, generatedAt: new Date().toISOString() };
  }

  private metadataString(value: Prisma.JsonValue, key: string): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private metadataNumber(value: Prisma.JsonValue, key: string): number | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'number' ? candidate : undefined;
  }

  private async lockCharacters(
    transaction: Prisma.TransactionClient,
    characterIds: readonly string[],
  ): Promise<void> {
    for (const characterId of [...new Set(characterIds)].sort()) {
      await this.lockCharacter(transaction, characterId);
    }
  }

  private async lockCharacter(
    transaction: Prisma.TransactionClient,
    characterId: string,
  ): Promise<void> {
    await this.lockOperation(transaction, `item-economy:${characterId}`);
  }

  private async lockOperation(
    transaction: Prisma.TransactionClient,
    key: string,
  ): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private boundedLimit(limit: number): number {
    if (!Number.isFinite(limit)) return 100;
    return Math.max(1, Math.min(500, Math.trunc(limit)));
  }

  private invalid(details?: Record<string, unknown>): never {
    throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', details);
  }
}
