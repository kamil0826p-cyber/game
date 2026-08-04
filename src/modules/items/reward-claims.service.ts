import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  ITEM_INVENTORY_CAPACITY,
  ItemInventoryService,
} from './item-inventory.service.js';
import {
  itemStackKey,
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
} from './itemization.rules.js';
import type { ItemInstanceSnapshot } from './itemization.types.js';
import type {
  RewardClaimExpirationResult,
  RewardClaimItemPayload,
  RewardClaimMutationResult,
  RewardClaimPayload,
  RewardClaimSource,
  RewardClaimsSnapshot,
} from './reward-claims.contracts.js';

export const REWARD_CLAIM_EXPIRING_SOON_MS = 72 * 60 * 60 * 1000;
export const REWARD_CLAIM_BATCH_LIMIT = 100;

export interface RewardClaimPlacementInput {
  quantity: number;
  stackLimit: number;
  stackable: boolean;
  matchingStackQuantities: readonly number[];
  occupiedSlots: number;
  inventoryCapacity: number;
}

export const rewardClaimPlacement = (
  input: RewardClaimPlacementInput,
): {
  matchingStackSpace: number;
  requiredSlots: number;
  freeSlots: number;
  canClaim: boolean;
} => {
  const freeSlots = Math.max(0, input.inventoryCapacity - input.occupiedSlots);
  const matchingStackSpace = input.stackable
    ? input.matchingStackQuantities.reduce(
        (sum, quantity) => sum + Math.max(0, input.stackLimit - quantity),
        0,
      )
    : 0;
  const remaining = Math.max(0, input.quantity - matchingStackSpace);
  const requiredSlots = Math.ceil(remaining / Math.max(1, input.stackLimit));
  return {
    matchingStackSpace,
    requiredSlots,
    freeSlots,
    canClaim: requiredSlots <= freeSlots,
  };
};

export const rewardClaimSource = (reason: string): RewardClaimSource => {
  const normalized = reason.toUpperCase();
  if (normalized.startsWith('MARKET')) return 'MARKET';
  if (normalized.startsWith('CRAFT')) return 'CRAFTING';
  if (normalized.startsWith('COMBAT') || normalized.startsWith('ENCOUNTER')) return 'COMBAT';
  if (normalized.startsWith('QUEST')) return 'QUEST';
  if (normalized.startsWith('LOOT') || normalized.startsWith('MOB')) return 'LOOT';
  if (normalized.startsWith('ADMIN')) return 'ADMIN';
  return 'OTHER';
};

type ClaimRecord = {
  id: string;
  characterId: string;
  itemDefinitionId: string;
  quantity: number;
  instanceData: Prisma.JsonValue;
  status: 'OPEN' | 'CLAIMED' | 'EXPIRED';
  reason: string;
  expiresAt: Date;
  createdAt: Date;
};

type CollectResolution =
  | {
      type: 'CLAIMED';
      claimId: string;
      quantity: number;
    }
  | {
      type: 'EXPIRED';
      claimId: string;
    };

@Injectable()
export class RewardClaimsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: ItemInventoryService,
  ) {}

  async getSnapshot(userId: string, characterId: string): Promise<RewardClaimsSnapshot> {
    await this.requireOwnedCharacter(userId, characterId);
    return this.snapshot(characterId);
  }

  async claimOne(
    userId: string,
    characterId: string,
    claimId: string,
    operationId: string,
  ): Promise<RewardClaimMutationResult> {
    const resolution = await this.collectClaim(
      userId,
      characterId,
      claimId,
      this.operationId(operationId),
    );
    if (resolution.type === 'EXPIRED') {
      this.invalid({ claimId, reason: 'REWARD_CLAIM_EXPIRED' });
    }
    return {
      snapshot: await this.snapshot(characterId),
      mutation: {
        kind: 'CLAIMED',
        claimedIds: [resolution.claimId],
        claimedCount: 1,
        claimedQuantity: resolution.quantity,
        blockedIds: [],
        expiredIds: [],
      },
    };
  }

  async claimAll(
    userId: string,
    characterId: string,
    operationId: string,
  ): Promise<RewardClaimMutationResult> {
    await this.requireOwnedCharacter(userId, characterId);
    const normalizedOperationId = this.operationId(operationId);
    const claims = await this.prisma.itemClaim.findMany({
      where: {
        characterId,
        status: 'OPEN',
        expiresAt: { gt: new Date() },
      },
      orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      take: REWARD_CLAIM_BATCH_LIMIT,
      select: { id: true },
    });
    const claimedIds: string[] = [];
    const blockedIds: string[] = [];
    const expiredIds: string[] = [];
    let claimedQuantity = 0;

    for (const claim of claims) {
      try {
        const resolution = await this.collectClaim(
          userId,
          characterId,
          claim.id,
          this.batchOperationId(normalizedOperationId, claim.id),
        );
        if (resolution.type === 'EXPIRED') {
          expiredIds.push(resolution.claimId);
        } else {
          claimedIds.push(resolution.claimId);
          claimedQuantity += resolution.quantity;
        }
      } catch (error) {
        if (this.isInventoryFull(error)) {
          blockedIds.push(claim.id);
          continue;
        }
        if (error instanceof GameError && error.details?.reason === 'REWARD_CLAIM_EXPIRED') {
          expiredIds.push(claim.id);
          continue;
        }
        throw error;
      }
    }

    return {
      snapshot: await this.snapshot(characterId),
      mutation: {
        kind: 'CLAIMED_ALL',
        claimedIds,
        claimedCount: claimedIds.length,
        claimedQuantity,
        blockedIds,
        expiredIds,
      },
    };
  }

  async expireOpenClaims(limit = REWARD_CLAIM_BATCH_LIMIT): Promise<RewardClaimExpirationResult> {
    const claims = await this.prisma.itemClaim.findMany({
      where: { status: 'OPEN', expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: this.boundedLimit(limit),
      select: { id: true, characterId: true },
    });
    const characterIds = new Set<string>();
    let expiredCount = 0;
    for (const claim of claims) {
      const changed = await this.prisma.$transaction(async (transaction) => {
        await this.lockCharacter(transaction, claim.characterId);
        await this.lockOperation(transaction, `reward-claim:${claim.id}`);
        const current = await transaction.itemClaim.findUnique({ where: { id: claim.id } });
        if (
          !current ||
          current.status !== 'OPEN' ||
          current.expiresAt.getTime() > Date.now()
        ) {
          return false;
        }
        await transaction.itemClaim.update({
          where: { id: current.id },
          data: { status: 'EXPIRED' },
        });
        await this.inventory.recordEvent(transaction, {
          characterId: current.characterId,
          operationId: `claim-expired:${current.id}`,
          eventType: 'CLAIM_EXPIRED',
          quantity: current.quantity,
          metadata: { claimId: current.id, reason: current.reason },
        });
        return true;
      });
      if (changed) {
        expiredCount += 1;
        characterIds.add(claim.characterId);
      }
    }
    return { expiredCount, characterIds: [...characterIds] };
  }

  private async collectClaim(
    userId: string,
    characterId: string,
    claimId: string,
    operationId: string,
  ): Promise<CollectResolution> {
    return this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      await this.lockOperation(transaction, `reward-claim:${claimId}`);
      await this.requireCharacter(transaction, userId, characterId);
      const claim = (await transaction.itemClaim.findFirst({
        where: { id: claimId, characterId },
      })) as ClaimRecord | null;
      if (!claim) this.invalid({ claimId });

      const eventOperationId = this.claimEventOperation(operationId, claim.id);
      const repeated = await transaction.itemEconomyEvent.findUnique({
        where: {
          characterId_operationId_eventType: {
            characterId,
            operationId: eventOperationId,
            eventType: 'CLAIM_COLLECTED',
          },
        },
      });
      if (repeated) {
        if (this.metadataString(repeated.metadata, 'claimId') !== claim.id) {
          this.invalid({ reason: 'OPERATION_ID_REUSED' });
        }
        return { type: 'CLAIMED', claimId: claim.id, quantity: claim.quantity };
      }
      if (claim.status !== 'OPEN') this.invalid({ claimId, reason: 'REWARD_CLAIM_CLOSED' });
      if (claim.expiresAt.getTime() <= Date.now()) {
        await transaction.itemClaim.update({
          where: { id: claim.id },
          data: { status: 'EXPIRED' },
        });
        await this.inventory.recordEvent(transaction, {
          characterId,
          operationId: `claim-expired:${claim.id}`,
          eventType: 'CLAIM_EXPIRED',
          quantity: claim.quantity,
          metadata: { claimId: claim.id, reason: claim.reason },
        });
        return { type: 'EXPIRED', claimId: claim.id };
      }

      const definition = await transaction.itemDefinition.findUniqueOrThrow({
        where: { id: claim.itemDefinitionId },
      });
      const metadata = parseItemDefinitionMetadata(definition.metadata);
      const itemSnapshot = readItemInstanceSnapshot({
        instanceData: claim.instanceData,
        definitionKey: definition.key,
        metadata,
      });
      await this.inventory.grant(transaction, {
        characterId,
        definition,
        quantity: claim.quantity,
        snapshot: itemSnapshot,
        operationId,
        reason: `CLAIM:${claim.reason}`,
        claimOverflow: false,
      });
      await transaction.itemClaim.update({
        where: { id: claim.id },
        data: { status: 'CLAIMED', claimedAt: new Date() },
      });
      await this.inventory.recordEvent(transaction, {
        characterId,
        operationId: eventOperationId,
        eventType: 'CLAIM_COLLECTED',
        itemDefinitionKey: definition.key,
        quantity: claim.quantity,
        metadata: { claimId: claim.id, reason: claim.reason },
      });
      return { type: 'CLAIMED', claimId: claim.id, quantity: claim.quantity };
    });
  }

  private async snapshot(characterId: string): Promise<RewardClaimsSnapshot> {
    const now = Date.now();
    const [claims, inventoryItems] = await Promise.all([
      this.prisma.itemClaim.findMany({
        where: {
          characterId,
          status: 'OPEN',
          expiresAt: { gt: new Date(now) },
        },
        orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.inventoryItem.findMany({
        where: { characterId },
        include: { itemDefinition: true },
        orderBy: { slotIndex: 'asc' },
      }),
    ]);
    const definitions = await this.prisma.itemDefinition.findMany({
      where: { id: { in: [...new Set(claims.map((claim) => claim.itemDefinitionId))] } },
    });
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const payloads: RewardClaimPayload[] = claims.flatMap((claim) => {
      const definition = definitionsById.get(claim.itemDefinitionId);
      if (!definition) return [];
      const metadata = parseItemDefinitionMetadata(definition.metadata);
      const itemSnapshot = readItemInstanceSnapshot({
        instanceData: claim.instanceData,
        definitionKey: definition.key,
        metadata,
      });
      const claimStackKey = itemStackKey(definition.key, metadata, itemSnapshot);
      const matchingStackQuantities = inventoryItems.flatMap((item) => {
        if (
          item.itemDefinitionId !== definition.id ||
          item.equippedSlot ||
          item.quantity >= definition.stackLimit
        ) {
          return [];
        }
        const stackMetadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
        const stackSnapshot = readItemInstanceSnapshot({
          instanceData: item.instanceData,
          definitionKey: item.itemDefinition.key,
          metadata: stackMetadata,
        });
        return itemStackKey(item.itemDefinition.key, stackMetadata, stackSnapshot) === claimStackKey
          ? [item.quantity]
          : [];
      });
      const capacity = rewardClaimPlacement({
        quantity: claim.quantity,
        stackLimit: definition.stackLimit,
        stackable: definition.stackLimit > 1 && metadata.category !== 'EQUIPMENT',
        matchingStackQuantities,
        occupiedSlots: inventoryItems.length,
        inventoryCapacity: ITEM_INVENTORY_CAPACITY,
      });
      const expiresInMs = Math.max(0, claim.expiresAt.getTime() - now);
      return [
        {
          id: claim.id,
          item: this.itemPayload(definition, metadata, itemSnapshot),
          quantity: claim.quantity,
          reason: claim.reason,
          source: rewardClaimSource(claim.reason),
          createdAt: claim.createdAt.getTime(),
          expiresAt: claim.expiresAt.getTime(),
          expiresInMs,
          expiringSoon: expiresInMs <= REWARD_CLAIM_EXPIRING_SOON_MS,
          capacity,
        },
      ];
    });
    return {
      claims: payloads,
      summary: {
        totalClaims: payloads.length,
        totalQuantity: payloads.reduce((sum, claim) => sum + claim.quantity, 0),
        expiringSoonCount: payloads.filter((claim) => claim.expiringSoon).length,
        inventorySlotsUsed: inventoryItems.length,
        inventoryCapacity: ITEM_INVENTORY_CAPACITY,
        freeSlots: Math.max(0, ITEM_INVENTORY_CAPACITY - inventoryItems.length),
      },
      refreshedAt: now,
    };
  }

  private itemPayload(
    definition: {
      key: string;
      name: string;
      description: string;
      stackLimit: number;
      metadata: Prisma.JsonValue;
    },
    metadata: ReturnType<typeof parseItemDefinitionMetadata>,
    snapshot: ItemInstanceSnapshot,
  ): RewardClaimItemPayload {
    return {
      definitionKey: definition.key,
      name: definition.name,
      description: definition.description,
      icon: metadata.icon,
      category: metadata.category,
      rarity: metadata.rarity,
      equipmentSlot: metadata.equipmentSlot,
      requiredClass: metadata.requiredClass,
      minimumLevel: metadata.minimumLevel ?? 1,
      stackLimit: definition.stackLimit,
      statBonuses: { ...(metadata.statBonuses ?? {}) },
      powerLevel: snapshot.powerLevel,
      craftQuality: snapshot.craftQuality,
      affixes: snapshot.affixes.map((affix) => ({
        name: affix.name,
        tier: affix.tier,
        statBonuses: { ...affix.statBonuses },
      })),
      relic: snapshot.relic
        ? {
            key: snapshot.relic.key,
            name: snapshot.relic.name,
            description: snapshot.relic.description,
          }
        : undefined,
      curse: snapshot.curse
        ? {
            key: snapshot.curse.key,
            name: snapshot.curse.name,
            description: snapshot.curse.description,
            preview: snapshot.curse.preview,
          }
        : undefined,
    };
  }

  private async requireOwnedCharacter(userId: string, characterId: string): Promise<void> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
  }

  private async requireCharacter(
    transaction: Prisma.TransactionClient,
    userId: string,
    characterId: string,
  ): Promise<void> {
    const character = await transaction.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
  }

  private claimEventOperation(operationId: string, claimId: string): string {
    const hash = Buffer.from(claimId).toString('base64url').slice(0, 24);
    return `${operationId}:${hash}`.slice(0, 128);
  }

  private batchOperationId(operationId: string, claimId: string): string {
    return `claim-all:${createHash('sha256')
      .update(`${operationId}:${claimId}`)
      .digest('hex')
      .slice(0, 40)}`;
  }

  private operationId(value: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 96) this.invalid({ reason: 'OPERATION_ID_INVALID' });
    return normalized;
  }

  private boundedLimit(value: number): number {
    return Number.isFinite(value)
      ? Math.max(1, Math.min(500, Math.trunc(value)))
      : REWARD_CLAIM_BATCH_LIMIT;
  }

  private metadataString(value: Prisma.JsonValue, key: string): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'string' ? candidate : undefined;
  }

  private isInventoryFull(error: unknown): boolean {
    return error instanceof GameError && error.code === GAME_ERROR_CODES.INVENTORY_FULL;
  }

  private async lockCharacter(
    transaction: Prisma.TransactionClient,
    characterId: string,
  ): Promise<void> {
    await this.lockOperation(transaction, `item-economy:${characterId}`);
  }

  private async lockOperation(transaction: Prisma.TransactionClient, key: string): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private invalid(details?: Record<string, unknown>): never {
    throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', details);
  }
}
