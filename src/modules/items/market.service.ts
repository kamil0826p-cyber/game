import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ItemInventoryService } from './item-inventory.service.js';
import type {
  MarketItemPayload,
  MarketListingPayload,
  MarketMutationResult,
  MarketSnapshot,
  MarketStationSession,
} from './market.contracts.js';
import {
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
} from './itemization.rules.js';
import type { ItemInstanceSnapshot } from './itemization.types.js';

export const MARKET_LISTING_TTL_MS = 3 * 24 * 60 * 60 * 1000;
export const MARKET_ACTIVE_LISTING_LIMIT = 20;
export const MARKET_LISTING_FEE_RATE = 0.02;
export const MARKET_COMMISSION_RATE = 0.05;
export const MARKET_MIN_PRICE_SILVER = 1;
export const MARKET_MAX_PRICE_SILVER = 2_147_483_647;

interface MarketMutationContext {
  station: MarketStationSession;
  npcName: string;
}

type ListingRecord = {
  id: string;
  sellerCharacterId: string;
  buyerCharacterId: string | null;
  itemDefinitionId: string;
  quantity: number;
  instanceData: Prisma.JsonValue;
  priceSilver: number;
  listingFeeSilver: number;
  status: 'ACTIVE' | 'SOLD' | 'CANCELLED' | 'EXPIRED';
  expiresAt: Date;
  createdAt: Date;
  closedAt: Date | null;
};

@Injectable()
export class MarketService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: ItemInventoryService,
  ) {}

  async getSnapshot(
    userId: string,
    characterId: string,
    station: MarketStationSession,
    npcName: string,
  ): Promise<MarketSnapshot> {
    await this.expireListings(100);
    const character = await this.requireOwnedCharacter(userId, characterId);
    const realmCharacters = await this.prisma.character.findMany({
      where: { realmId: character.realmId },
      select: { id: true, name: true },
    });
    const realmCharacterIds = realmCharacters.map((entry) => entry.id);
    const names = new Map(realmCharacters.map((entry) => [entry.id, entry.name]));
    const [active, mine, inventoryItems, activeListingCount] = await Promise.all([
      this.prisma.itemMarketListing.findMany({
        where: {
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
          sellerCharacterId: { in: realmCharacterIds },
        },
        orderBy: [{ priceSilver: 'asc' }, { createdAt: 'asc' }],
        take: 200,
      }),
      this.prisma.itemMarketListing.findMany({
        where: { sellerCharacterId: characterId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.inventoryItem.findMany({
        where: {
          characterId,
          equippedSlot: null,
          tradeOfferItems: { none: {} },
        },
        include: { itemDefinition: true },
        orderBy: { slotIndex: 'asc' },
      }),
      this.prisma.itemMarketListing.count({
        where: {
          sellerCharacterId: characterId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
      }),
    ]);
    const listingRecords = [...active, ...mine] as ListingRecord[];
    const definitionIds = [
      ...new Set([
        ...listingRecords.map((listing) => listing.itemDefinitionId),
        ...inventoryItems.map((item) => item.itemDefinitionId),
      ]),
    ];
    const definitions = await this.prisma.itemDefinition.findMany({
      where: { id: { in: definitionIds } },
    });
    const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
    const definitionKeys = definitions.map((definition) => definition.key);
    const medians = await this.marketMedians(definitionKeys);

    const toPayload = (listing: ListingRecord): MarketListingPayload => {
      const definition = definitionsById.get(listing.itemDefinitionId);
      if (!definition) throw new Error('MARKET_ITEM_DEFINITION_MISSING');
      const metadata = parseItemDefinitionMetadata(definition.metadata);
      const snapshot = readItemInstanceSnapshot({
        instanceData: listing.instanceData,
        definitionKey: definition.key,
        metadata,
      });
      const commission = this.commission(listing.priceSilver);
      return {
        id: listing.id,
        seller: {
          characterId: listing.sellerCharacterId,
          name: names.get(listing.sellerCharacterId) ?? 'Unknown player',
        },
        buyer: listing.buyerCharacterId
          ? {
              characterId: listing.buyerCharacterId,
              name: names.get(listing.buyerCharacterId) ?? 'Unknown player',
            }
          : undefined,
        item: this.itemPayload(definition, metadata, snapshot),
        quantity: listing.quantity,
        totalPriceSilver: listing.priceSilver,
        unitPriceSilver: Math.ceil(listing.priceSilver / listing.quantity),
        listingFeeSilver: listing.listingFeeSilver,
        commissionSilver: commission,
        sellerRevenueSilver: listing.priceSilver - commission,
        historicalMedianUnitPriceSilver: medians.get(definition.key),
        status: listing.status,
        createdAt: listing.createdAt.getTime(),
        expiresAt: listing.expiresAt.getTime(),
        closedAt: listing.closedAt?.getTime(),
        canBuy:
          listing.status === 'ACTIVE' &&
          listing.expiresAt.getTime() > Date.now() &&
          listing.sellerCharacterId !== characterId &&
          character.silver >= listing.priceSilver,
        canCancel:
          listing.status === 'ACTIVE' &&
          listing.expiresAt.getTime() > Date.now() &&
          listing.sellerCharacterId === characterId,
      };
    };

    const sellableItems = inventoryItems.flatMap((item) => {
      const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
      const snapshot = readItemInstanceSnapshot({
        instanceData: item.instanceData,
        definitionKey: item.itemDefinition.key,
        metadata,
      });
      if (snapshot.tradePolicy !== 'TRADEABLE' || snapshot.boundCharacterId) return [];
      return [
        {
          inventoryItemId: item.id,
          item: this.itemPayload(item.itemDefinition, metadata, snapshot),
          quantity: item.quantity,
          suggestedUnitPriceSilver: medians.get(item.itemDefinition.key),
        },
      ];
    });

    return {
      station: { npcId: station.npcId, npcName, marketKey: station.marketKey },
      silver: character.silver,
      listings: active.map((listing) => toPayload(listing as ListingRecord)),
      mine: mine.map((listing) => toPayload(listing as ListingRecord)),
      sellableItems,
      rules: {
        activeListingLimit: MARKET_ACTIVE_LISTING_LIMIT,
        activeListingCount,
        listingTtlMs: MARKET_LISTING_TTL_MS,
        listingFeeRate: MARKET_LISTING_FEE_RATE,
        commissionRate: MARKET_COMMISSION_RATE,
        minimumPriceSilver: MARKET_MIN_PRICE_SILVER,
        maximumPriceSilver: MARKET_MAX_PRICE_SILVER,
      },
    };
  }

  async list(
    userId: string,
    characterId: string,
    context: MarketMutationContext,
    itemId: string,
    quantity: number,
    priceSilver: number,
    operationId: string,
  ): Promise<MarketMutationResult> {
    const normalizedOperationId = this.operationId(operationId);
    this.quantity(quantity);
    this.price(priceSilver);
    const listingId = await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const existing = await transaction.itemMarketListing.findUnique({
        where: {
          sellerCharacterId_operationId: {
            sellerCharacterId: characterId,
            operationId: normalizedOperationId,
          },
        },
      });
      if (existing) {
        const event = await transaction.itemEconomyEvent.findUnique({
          where: {
            characterId_operationId_eventType: {
              characterId,
              operationId: normalizedOperationId,
              eventType: 'MARKET_LISTED',
            },
          },
        });
        if (
          existing.quantity !== quantity ||
          existing.priceSilver !== priceSilver ||
          event?.inventoryItemId !== itemId
        ) {
          this.invalid({ reason: 'OPERATION_ID_REUSED' });
        }
        return existing.id;
      }
      const character = await this.requireCharacter(transaction, userId, characterId);
      const activeListings = await transaction.itemMarketListing.count({
        where: {
          sellerCharacterId: characterId,
          status: 'ACTIVE',
          expiresAt: { gt: new Date() },
        },
      });
      if (activeListings >= MARKET_ACTIVE_LISTING_LIMIT) {
        this.invalid({ reason: 'MARKET_LISTING_LIMIT', limit: MARKET_ACTIVE_LISTING_LIMIT });
      }
      const item = await this.inventory.removeOwnedItem(transaction, {
        characterId,
        itemId,
        quantity,
      });
      const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
      const snapshot = readItemInstanceSnapshot({
        instanceData: item.instanceData,
        definitionKey: item.itemDefinition.key,
        metadata,
      });
      if (snapshot.tradePolicy !== 'TRADEABLE' || snapshot.boundCharacterId) {
        this.invalid({ itemId, reason: 'ITEM_NOT_TRADEABLE' });
      }
      const listingFee = this.listingFee(priceSilver);
      const nextSilver = this.debitSilver(character.silver, listingFee);
      await transaction.character.update({
        where: { id: characterId },
        data: { silver: nextSilver },
      });
      await transaction.characterCurrencyLedger.create({
        data: {
          characterId,
          operationId: `market-list:${normalizedOperationId}`,
          currency: 'SILVER',
          direction: 'DEBIT',
          amount: listingFee,
          reason: 'MARKET_LISTING_FEE',
          balanceAfter: nextSilver,
          metadata: { itemKey: item.itemDefinition.key, quantity, priceSilver },
        },
      });
      const listing = await transaction.itemMarketListing.create({
        data: {
          sellerCharacterId: characterId,
          itemDefinitionId: item.itemDefinitionId,
          quantity,
          instanceData: item.instanceData,
          priceSilver,
          listingFeeSilver: listingFee,
          operationId: normalizedOperationId,
          expiresAt: new Date(Date.now() + MARKET_LISTING_TTL_MS),
        },
      });
      await this.inventory.recordEvent(transaction, {
        characterId,
        operationId: normalizedOperationId,
        eventType: 'MARKET_LISTED',
        itemDefinitionKey: item.itemDefinition.key,
        inventoryItemId: item.id,
        quantity,
        silverDelta: -listingFee,
        metadata: { listingId: listing.id, priceSilver, listingFee },
      });
      return listing.id;
    });
    const snapshot = await this.getSnapshot(
      userId,
      characterId,
      context.station,
      context.npcName,
    );
    const listing = snapshot.mine.find((entry) => entry.id === listingId);
    if (!listing) throw new Error('MARKET_LISTING_PAYLOAD_MISSING');
    return {
      snapshot,
      mutation: {
        kind: 'LISTED',
        listingId,
        itemName: listing.item.name,
        quantity: listing.quantity,
        silverDelta: -listing.listingFeeSilver,
      },
    };
  }

  async buy(
    userId: string,
    buyerCharacterId: string,
    context: MarketMutationContext,
    listingId: string,
    operationId: string,
  ): Promise<MarketMutationResult> {
    const normalizedOperationId = this.operationId(operationId);
    const purchase = await this.prisma.$transaction(async (transaction) => {
      await this.lockOperation(transaction, `market:${listingId}`);
      let listing = await transaction.itemMarketListing.findUnique({ where: { id: listingId } });
      if (!listing) this.invalid({ listingId });
      await this.lockCharacters(transaction, [buyerCharacterId, listing.sellerCharacterId]);
      listing = await transaction.itemMarketListing.findUnique({ where: { id: listingId } });
      if (!listing) this.invalid({ listingId });
      const buyer = await this.requireCharacter(transaction, userId, buyerCharacterId);
      const repeated = await transaction.characterCurrencyLedger.findUnique({
        where: {
          characterId_operationId: {
            characterId: buyerCharacterId,
            operationId: `market-buy:${normalizedOperationId}`,
          },
        },
      });
      if (repeated) {
        if (this.metadataString(repeated.metadata, 'listingId') !== listingId) {
          this.invalid({ reason: 'OPERATION_ID_REUSED' });
        }
        return {
          listingId,
          sellerCharacterId: listing.sellerCharacterId,
          itemDefinitionId: listing.itemDefinitionId,
          quantity: listing.quantity,
          priceSilver: listing.priceSilver,
          delivery: this.metadataString(repeated.metadata, 'delivery') === 'CLAIMS'
            ? ('CLAIMS' as const)
            : ('INVENTORY' as const),
        };
      }
      if (listing.status !== 'ACTIVE') this.invalid({ listingId, reason: 'MARKET_LISTING_CLOSED' });
      if (listing.sellerCharacterId === buyerCharacterId) {
        this.invalid({ listingId, reason: 'MARKET_SELF_TRADE' });
      }
      if (listing.expiresAt.getTime() <= Date.now()) {
        await this.returnListing(transaction, listing as ListingRecord, 'EXPIRED');
        this.invalid({ listingId, reason: 'MARKET_LISTING_EXPIRED_RETURNED' });
      }
      const seller = await transaction.character.findUnique({
        where: { id: listing.sellerCharacterId },
        select: { id: true, realmId: true, silver: true },
      });
      if (!seller || seller.realmId !== buyer.realmId) {
        this.invalid({ listingId, reason: 'MARKET_REALM_MISMATCH' });
      }
      const definition = await transaction.itemDefinition.findUniqueOrThrow({
        where: { id: listing.itemDefinitionId },
      });
      const metadata = parseItemDefinitionMetadata(definition.metadata);
      const itemSnapshot = readItemInstanceSnapshot({
        instanceData: listing.instanceData,
        definitionKey: definition.key,
        metadata,
      });
      const buyerSilver = this.debitSilver(buyer.silver, listing.priceSilver);
      const commission = this.commission(listing.priceSilver);
      const sellerRevenue = listing.priceSilver - commission;
      const sellerSilver = seller.silver + sellerRevenue;
      await transaction.character.update({
        where: { id: buyerCharacterId },
        data: { silver: buyerSilver },
      });
      await transaction.character.update({
        where: { id: seller.id },
        data: { silver: sellerSilver },
      });
      const grant = await this.inventory.grant(transaction, {
        characterId: buyerCharacterId,
        definition,
        quantity: listing.quantity,
        snapshot: this.transferSnapshot(
          itemSnapshot,
          seller.id,
          buyerCharacterId,
          normalizedOperationId,
        ),
        operationId: `market-delivery:${listing.id}`,
        reason: `MARKET:${listing.id}`,
      });
      const delivery = grant.claimedQuantity > 0 ? ('CLAIMS' as const) : ('INVENTORY' as const);
      await transaction.characterCurrencyLedger.create({
        data: {
          characterId: buyerCharacterId,
          operationId: `market-buy:${normalizedOperationId}`,
          currency: 'SILVER',
          direction: 'DEBIT',
          amount: listing.priceSilver,
          reason: 'MARKET_PURCHASE',
          balanceAfter: buyerSilver,
          metadata: { listingId, sellerCharacterId: seller.id, commission, delivery },
        },
      });
      await transaction.characterCurrencyLedger.create({
        data: {
          characterId: seller.id,
          operationId: `market-sale:${listing.id}`,
          currency: 'SILVER',
          direction: 'CREDIT',
          amount: sellerRevenue,
          reason: 'MARKET_SALE',
          balanceAfter: sellerSilver,
          metadata: { listingId, buyerCharacterId, commission },
        },
      });
      await transaction.itemMarketListing.update({
        where: { id: listing.id },
        data: { status: 'SOLD', buyerCharacterId, closedAt: new Date() },
      });
      await transaction.itemMarketPriceSample.create({
        data: {
          listingId: listing.id,
          itemDefinitionKey: definition.key,
          unitPriceSilver: Math.ceil(listing.priceSilver / listing.quantity),
          quantity: listing.quantity,
        },
      });
      await this.inventory.recordEvent(transaction, {
        characterId: buyerCharacterId,
        operationId: normalizedOperationId,
        eventType: 'MARKET_PURCHASED',
        itemDefinitionKey: definition.key,
        quantity: listing.quantity,
        silverDelta: -listing.priceSilver,
        metadata: { listingId, sellerCharacterId: seller.id, commission, delivery },
      });
      await this.inventory.recordEvent(transaction, {
        characterId: seller.id,
        operationId: listing.id,
        eventType: 'MARKET_SOLD',
        itemDefinitionKey: definition.key,
        quantity: listing.quantity,
        silverDelta: sellerRevenue,
        metadata: { listingId, buyerCharacterId, commission },
      });
      return {
        listingId,
        sellerCharacterId: seller.id,
        itemDefinitionId: definition.id,
        quantity: listing.quantity,
        priceSilver: listing.priceSilver,
        delivery,
      };
    });
    const snapshot = await this.getSnapshot(
      userId,
      buyerCharacterId,
      context.station,
      context.npcName,
    );
    const definition = await this.prisma.itemDefinition.findUniqueOrThrow({
      where: { id: purchase.itemDefinitionId },
      select: { name: true },
    });
    return {
      snapshot,
      mutation: {
        kind: 'PURCHASED',
        listingId: purchase.listingId,
        itemName: definition.name,
        quantity: purchase.quantity,
        silverDelta: -purchase.priceSilver,
        delivery: purchase.delivery,
        sellerCharacterId: purchase.sellerCharacterId,
      },
    };
  }

  async cancel(
    userId: string,
    characterId: string,
    context: MarketMutationContext,
    listingId: string,
  ): Promise<MarketMutationResult> {
    const returned = await this.prisma.$transaction(async (transaction) => {
      await this.lockOperation(transaction, `market:${listingId}`);
      await this.lockCharacter(transaction, characterId);
      await this.requireCharacter(transaction, userId, characterId);
      const listing = await transaction.itemMarketListing.findFirst({
        where: { id: listingId, sellerCharacterId: characterId },
      });
      if (!listing) this.invalid({ listingId });
      if (listing.status === 'CANCELLED' || listing.status === 'EXPIRED') {
        return { itemDefinitionId: listing.itemDefinitionId, quantity: listing.quantity };
      }
      if (listing.status !== 'ACTIVE') this.invalid({ listingId });
      await this.returnListing(transaction, listing as ListingRecord, 'CANCELLED');
      return { itemDefinitionId: listing.itemDefinitionId, quantity: listing.quantity };
    });
    const [snapshot, definition] = await Promise.all([
      this.getSnapshot(userId, characterId, context.station, context.npcName),
      this.prisma.itemDefinition.findUniqueOrThrow({
        where: { id: returned.itemDefinitionId },
        select: { name: true },
      }),
    ]);
    return {
      snapshot,
      mutation: {
        kind: 'CANCELLED',
        listingId,
        itemName: definition.name,
        quantity: returned.quantity,
        silverDelta: 0,
      },
    };
  }

  async expireListings(limit = 100): Promise<string[]> {
    const listings = await this.prisma.itemMarketListing.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: Math.max(1, Math.min(500, Math.trunc(limit))),
    });
    const sellerIds: string[] = [];
    for (const listing of listings) {
      const changed = await this.prisma.$transaction(async (transaction) => {
        await this.lockOperation(transaction, `market:${listing.id}`);
        await this.lockCharacter(transaction, listing.sellerCharacterId);
        const current = await transaction.itemMarketListing.findUnique({ where: { id: listing.id } });
        if (
          !current ||
          current.status !== 'ACTIVE' ||
          current.expiresAt.getTime() > Date.now()
        ) {
          return false;
        }
        await this.returnListing(transaction, current as ListingRecord, 'EXPIRED');
        return true;
      });
      if (changed) sellerIds.push(listing.sellerCharacterId);
    }
    return [...new Set(sellerIds)];
  }

  private async returnListing(
    transaction: Prisma.TransactionClient,
    listing: ListingRecord,
    status: 'CANCELLED' | 'EXPIRED',
  ): Promise<void> {
    const definition = await transaction.itemDefinition.findUniqueOrThrow({
      where: { id: listing.itemDefinitionId },
    });
    const metadata = parseItemDefinitionMetadata(definition.metadata);
    const snapshot = readItemInstanceSnapshot({
      instanceData: listing.instanceData,
      definitionKey: definition.key,
      metadata,
    });
    await this.inventory.grant(transaction, {
      characterId: listing.sellerCharacterId,
      definition,
      quantity: listing.quantity,
      snapshot,
      operationId: `market-return:${listing.id}`,
      reason: `MARKET_${status}`,
    });
    await transaction.itemMarketListing.update({
      where: { id: listing.id },
      data: { status, closedAt: new Date() },
    });
    await this.inventory.recordEvent(transaction, {
      characterId: listing.sellerCharacterId,
      operationId: `market-return:${listing.id}`,
      eventType: `MARKET_${status}`,
      itemDefinitionKey: definition.key,
      quantity: listing.quantity,
      metadata: { listingId: listing.id },
    });
  }

  private itemPayload(
    definition: { key: string; name: string; description: string; metadata: Prisma.JsonValue },
    metadata: ReturnType<typeof parseItemDefinitionMetadata>,
    snapshot: ItemInstanceSnapshot,
  ): MarketItemPayload {
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
      statBonuses: { ...(metadata.statBonuses ?? {}) },
      powerLevel: snapshot.powerLevel,
      craftQuality: snapshot.craftQuality,
      affixes: snapshot.affixes.map((affix) => ({
        name: affix.name,
        tier: affix.tier,
        statBonuses: { ...affix.statBonuses },
      })),
      relic: snapshot.relic
        ? { key: snapshot.relic.key, name: snapshot.relic.name, description: snapshot.relic.description }
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

  private async marketMedians(keys: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    await Promise.all(
      [...new Set(keys)].map(async (key) => {
        const samples = await this.prisma.itemMarketPriceSample.findMany({
          where: { itemDefinitionKey: key },
          orderBy: { unitPriceSilver: 'asc' },
          take: 101,
          select: { unitPriceSilver: true },
        });
        const median = samples[Math.floor(samples.length / 2)]?.unitPriceSilver;
        if (median !== undefined) result.set(key, median);
      }),
    );
    return result;
  }

  private async requireOwnedCharacter(userId: string, characterId: string) {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true, realmId: true, silver: true },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    return character;
  }

  private async requireCharacter(
    transaction: Prisma.TransactionClient,
    userId: string,
    characterId: string,
  ) {
    const character = await transaction.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true, realmId: true, silver: true },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    return character;
  }

  private transferSnapshot(
    snapshot: ItemInstanceSnapshot,
    previousOwnerCharacterId: string,
    nextOwnerCharacterId: string,
    operationId: string,
  ): ItemInstanceSnapshot {
    const next = JSON.parse(JSON.stringify(snapshot)) as ItemInstanceSnapshot;
    next.origin.previousOwnerCharacterId = previousOwnerCharacterId;
    next.mutations.push({
      sequence: next.mutations.length + 1,
      operationId,
      type: 'MARKET_TRANSFER',
      at: new Date().toISOString(),
      beforeHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'),
      afterHash: createHash('sha256')
        .update(`${JSON.stringify(snapshot)}:${nextOwnerCharacterId}:${operationId}`)
        .digest('hex'),
    });
    return next;
  }

  private listingFee(price: number): number {
    return Math.max(1, Math.floor(price * MARKET_LISTING_FEE_RATE));
  }

  private commission(price: number): number {
    return Math.min(price, Math.max(1, Math.floor(price * MARKET_COMMISSION_RATE)));
  }

  private quantity(value: number): void {
    if (!Number.isInteger(value) || value < 1 || value > 9_999) {
      this.invalid({ reason: 'MARKET_QUANTITY_INVALID' });
    }
  }

  private price(value: number): void {
    if (
      !Number.isInteger(value) ||
      value < MARKET_MIN_PRICE_SILVER ||
      value > MARKET_MAX_PRICE_SILVER
    ) {
      this.invalid({ reason: 'MARKET_PRICE_INVALID' });
    }
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

  private metadataString(value: Prisma.JsonValue, key: string): string | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const candidate = (value as Record<string, unknown>)[key];
    return typeof candidate === 'string' ? candidate : undefined;
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

  private async lockOperation(transaction: Prisma.TransactionClient, key: string): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }

  private invalid(details?: Record<string, unknown>): never {
    throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', details);
  }
}
