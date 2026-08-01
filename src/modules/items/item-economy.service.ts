import { createHash, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ITEM_RECIPES, ITEM_SALVAGE_PROFILES } from './itemization.catalog.js';
import { ItemInventoryService } from './item-inventory.service.js';
import {
  createItemInstanceSnapshot,
  lootProtectionRulesVersion,
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
  resolveLootProtection,
} from './itemization.rules.js';
import type {
  ItemInstanceSnapshot,
  ItemOriginSnapshot,
  ItemRecipeDefinition,
} from './itemization.types.js';

const CRAFT_ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MARKET_LISTING_TTL_MS = 3 * 24 * 60 * 60 * 1000;
const MARKET_ACTIVE_LISTING_LIMIT = 20;
const MARKET_LISTING_FEE_RATE = 0.02;
const MARKET_COMMISSION_RATE = 0.05;

@Injectable()
export class ItemEconomyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inventory: ItemInventoryService,
  ) {}

  recipes() {
    return Object.values(ITEM_RECIPES).map((recipe) => ({
      ...recipe,
      inputs: recipe.inputs.map((input) => ({ ...input })),
    }));
  }

  async craft(
    userId: string,
    characterId: string,
    recipeKey: string,
    operationId: string,
  ) {
    const recipe = this.requireRecipe(recipeKey);
    const normalizedOperationId = this.operationId(operationId);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const character = await this.requireCharacter(transaction, userId, characterId);
      const ledgerOperationId = `craft:${normalizedOperationId}`;
      const repeated = await transaction.characterCurrencyLedger.findUnique({
        where: { characterId_operationId: { characterId, operationId: ledgerOperationId } },
      });
      if (repeated) return;
      this.assertRecipeAccess(character, recipe);
      const output = await transaction.itemDefinition.findUnique({
        where: { key: recipe.outputItemKey },
      });
      if (!output) this.invalid({ recipeKey, reason: 'OUTPUT_DEFINITION_MISSING' });
      await this.inventory.consumeByDefinitionKeys(transaction, characterId, recipe.inputs);
      const nextSilver = this.debitSilver(character.silver, recipe.silverCost);
      await transaction.character.update({
        where: { id: characterId },
        data: { silver: nextSilver },
      });
      await transaction.characterCurrencyLedger.create({
        data: {
          characterId,
          operationId: ledgerOperationId,
          currency: 'SILVER',
          direction: 'DEBIT',
          amount: recipe.silverCost,
          reason: 'ITEM_CRAFT',
          balanceAfter: nextSilver,
          metadata: { recipeKey: recipe.key, recipeVersion: recipe.version },
        },
      });
      await this.recordConsumedInputs(transaction, characterId, normalizedOperationId, recipe);
      const metadata = parseItemDefinitionMetadata(output.metadata);
      const snapshot = this.craftedSnapshot({
        definitionKey: output.key,
        metadata,
        characterId,
        operationId: normalizedOperationId,
        recipe,
        crafterCharacterId: characterId,
      });
      await this.inventory.grant(transaction, {
        characterId,
        definition: output,
        quantity: recipe.outputQuantity,
        snapshot,
        operationId: `craft-output:${normalizedOperationId}`,
        reason: `CRAFT:${recipe.key}`,
      });
      await this.inventory.recordEvent(transaction, {
        characterId,
        operationId: normalizedOperationId,
        eventType: 'CRAFT_COMPLETED',
        itemDefinitionKey: output.key,
        quantity: recipe.outputQuantity,
        silverDelta: -recipe.silverCost,
        metadata: { recipeKey: recipe.key, recipeVersion: recipe.version },
      });
    });
    return this.snapshot(userId, characterId);
  }

  async createCraftOrder(
    userId: string,
    characterId: string,
    recipeKey: string,
    operationId: string,
  ) {
    const recipe = this.requireRecipe(recipeKey);
    const normalizedOperationId = this.operationId(operationId);
    const orderId = await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const existing = await transaction.itemCraftOrder.findUnique({
        where: {
          ownerCharacterId_operationId: {
            ownerCharacterId: characterId,
            operationId: normalizedOperationId,
          },
        },
      });
      if (existing) return existing.id;
      const character = await this.requireCharacter(transaction, userId, characterId);
      this.assertRecipeAccess(character, recipe);
      const output = await transaction.itemDefinition.findUnique({
        where: { key: recipe.outputItemKey },
      });
      if (!output) this.invalid({ recipeKey, reason: 'OUTPUT_DEFINITION_MISSING' });
      const escrow = await this.inventory.consumeByDefinitionKeys(
        transaction,
        characterId,
        recipe.inputs,
      );
      const nextSilver = this.debitSilver(character.silver, recipe.silverCost);
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
          amount: recipe.silverCost,
          reason: 'ITEM_CRAFT_ESCROW',
          balanceAfter: nextSilver,
          metadata: { recipeKey: recipe.key, recipeVersion: recipe.version },
        },
      });
      await this.recordConsumedInputs(transaction, characterId, normalizedOperationId, recipe);
      const order = await transaction.itemCraftOrder.create({
        data: {
          ownerCharacterId: characterId,
          recipeKey: recipe.key,
          recipeVersion: recipe.version,
          silverEscrow: recipe.silverCost,
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
        silverDelta: -recipe.silverCost,
        metadata: { orderId: order.id, recipeKey: recipe.key, inputEscrow: escrow },
      });
      return order.id;
    });
    return this.getCraftOrder(userId, characterId, orderId);
  }

  async fulfillCraftOrder(
    userId: string,
    crafterCharacterId: string,
    orderId: string,
    operationId: string,
  ) {
    const normalizedOperationId = this.operationId(operationId);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockOperation(transaction, `craft-order:${orderId}`);
      const crafter = await this.requireCharacter(transaction, userId, crafterCharacterId);
      const order = await transaction.itemCraftOrder.findUnique({ where: { id: orderId } });
      if (!order || order.status !== 'OPEN') this.invalid({ orderId });
      if (order.expiresAt.getTime() <= Date.now()) {
        await this.refundCraftOrder(transaction, order, 'EXPIRED', normalizedOperationId);
        this.invalid({ orderId, reason: 'ORDER_EXPIRED' });
      }
      if (order.ownerCharacterId === crafterCharacterId) {
        this.invalid({ orderId, reason: 'CRAFT_ORDER_SELF_FULFILL' });
      }
      const recipe = this.requireRecipe(order.recipeKey);
      if (recipe.version !== order.recipeVersion) this.invalid({ orderId, reason: 'RECIPE_VERSION_MISMATCH' });
      this.assertRecipeAccess(crafter, recipe);
      const output = await transaction.itemDefinition.findUniqueOrThrow({
        where: { id: order.outputItemDefinitionId },
      });
      const metadata = parseItemDefinitionMetadata(output.metadata);
      const snapshot = this.craftedSnapshot({
        definitionKey: output.key,
        metadata,
        characterId: order.ownerCharacterId,
        operationId: normalizedOperationId,
        recipe,
        crafterCharacterId,
      });
      await this.inventory.grant(transaction, {
        characterId: order.ownerCharacterId,
        definition: output,
        quantity: order.outputQuantity,
        snapshot,
        operationId: `craft-order-output:${order.id}`,
        reason: `CRAFT_ORDER:${order.id}`,
      });
      await transaction.itemCraftOrder.update({
        where: { id: order.id },
        data: {
          status: 'COMPLETED',
          crafterCharacterId,
          completedAt: new Date(),
          silverEscrow: 0,
          inputEscrow: [],
        },
      });
      await this.inventory.recordEvent(transaction, {
        characterId: order.ownerCharacterId,
        operationId: normalizedOperationId,
        eventType: 'CRAFT_ORDER_COMPLETED',
        itemDefinitionKey: output.key,
        quantity: order.outputQuantity,
        metadata: {
          orderId: order.id,
          recipeKey: recipe.key,
          crafterCharacterId,
          consumedSilver: order.silverEscrow,
        },
      });
      await this.inventory.recordEvent(transaction, {
        characterId: crafterCharacterId,
        operationId: normalizedOperationId,
        eventType: 'CRAFT_ORDER_FULFILLED',
        itemDefinitionKey: output.key,
        quantity: order.outputQuantity,
        metadata: { orderId: order.id, ownerCharacterId: order.ownerCharacterId },
      });
    });
    return this.snapshot(userId, crafterCharacterId);
  }

  async cancelCraftOrder(
    userId: string,
    characterId: string,
    orderId: string,
    operationId: string,
  ) {
    const normalizedOperationId = this.operationId(operationId);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockOperation(transaction, `craft-order:${orderId}`);
      await this.requireCharacter(transaction, userId, characterId);
      const order = await transaction.itemCraftOrder.findFirst({
        where: { id: orderId, ownerCharacterId: characterId },
      });
      if (!order || order.status !== 'OPEN') this.invalid({ orderId });
      await this.refundCraftOrder(transaction, order, 'CANCELLED', normalizedOperationId);
    });
    return this.snapshot(userId, characterId);
  }

  async salvage(
    userId: string,
    characterId: string,
    itemId: string,
    operationId: string,
  ) {
    const normalizedOperationId = this.operationId(operationId);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      await this.requireCharacter(transaction, userId, characterId);
      const repeated = await transaction.itemEconomyEvent.findUnique({
        where: {
          characterId_operationId_eventType: {
            characterId,
            operationId: normalizedOperationId,
            eventType: 'ITEM_SALVAGED',
          },
        },
      });
      if (repeated) return;
      const item = await transaction.inventoryItem.findFirst({
        where: {
          id: itemId,
          characterId,
          equippedSlot: null,
          tradeOfferItems: { none: {} },
        },
        include: { itemDefinition: true },
      });
      if (!item || item.quantity !== 1) this.invalid({ itemId });
      const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
      const snapshot = readItemInstanceSnapshot({
        instanceData: item.instanceData,
        definitionKey: item.itemDefinition.key,
        metadata,
      });
      if (snapshot.salvagePolicy !== 'ALLOWED' || metadata.category === 'QUEST') {
        this.invalid({ itemId, reason: 'SALVAGE_FORBIDDEN' });
      }
      const profileKey = metadata.mechanics?.salvageProfileKey;
      const profile = profileKey ? ITEM_SALVAGE_PROFILES[profileKey] : undefined;
      if (!profile) this.invalid({ itemId, reason: 'SALVAGE_PROFILE_MISSING' });
      await transaction.inventoryItem.delete({ where: { id: item.id } });
      await this.inventory.recordEvent(transaction, {
        characterId,
        operationId: normalizedOperationId,
        eventType: 'ITEM_SALVAGED',
        itemDefinitionKey: item.itemDefinition.key,
        inventoryItemId: item.id,
        quantity: 1,
        metadata: { profileKey: profile.key, profileVersion: profile.version },
      });
      for (const output of profile.deterministic) {
        await this.grantMaterial(
          transaction,
          characterId,
          output.itemKey,
          output.quantity,
          `salvage:${normalizedOperationId}`,
          item.itemDefinition.key,
        );
      }
      if (profile.rare) {
        const pity = await transaction.itemPityState.findUnique({
          where: {
            characterId_ruleKey: { characterId, ruleKey: profile.rare.pityKey },
          },
        });
        const result = resolveLootProtection({
          chance: profile.rare.chance,
          roll: this.deterministicRoll(`${characterId}:${normalizedOperationId}:${profile.rare.pityKey}`),
          misses: pity?.misses ?? 0,
          guaranteedAfterMisses: profile.rare.guaranteedAfterMisses,
        });
        await transaction.itemPityState.upsert({
          where: {
            characterId_ruleKey: { characterId, ruleKey: profile.rare.pityKey },
          },
          create: {
            characterId,
            ruleKey: profile.rare.pityKey,
            misses: result.nextMisses,
            rulesVersion: lootProtectionRulesVersion,
          },
          update: {
            misses: result.nextMisses,
            rulesVersion: lootProtectionRulesVersion,
          },
        });
        if (result.granted) {
          await this.grantMaterial(
            transaction,
            characterId,
            profile.rare.itemKey,
            1,
            `salvage-rare:${normalizedOperationId}`,
            item.itemDefinition.key,
          );
        }
        await this.inventory.recordEvent(transaction, {
          characterId,
          operationId: `${normalizedOperationId}:pity`,
          eventType: 'SALVAGE_PITY_UPDATED',
          itemDefinitionKey: profile.rare.itemKey,
          quantity: result.granted ? 1 : 0,
          metadata: {
            pityKey: profile.rare.pityKey,
            guaranteed: result.guaranteed,
            nextMisses: result.nextMisses,
            rulesVersion: lootProtectionRulesVersion,
          },
        });
      }
    });
    return this.snapshot(userId, characterId);
  }

  async createMarketListing(
    userId: string,
    characterId: string,
    itemId: string,
    quantity: number,
    priceSilver: number,
    operationId: string,
  ) {
    const normalizedOperationId = this.operationId(operationId);
    this.positiveSilver(priceSilver);
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
      if (existing) return existing.id;
      const character = await this.requireCharacter(transaction, userId, characterId);
      const activeListings = await transaction.itemMarketListing.count({
        where: { sellerCharacterId: characterId, status: 'ACTIVE' },
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
      const listingFee = Math.max(1, Math.floor(priceSilver * MARKET_LISTING_FEE_RATE));
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
    return this.getMarketListing(listingId);
  }

  async buyMarketListing(
    userId: string,
    buyerCharacterId: string,
    listingId: string,
    operationId: string,
  ) {
    const normalizedOperationId = this.operationId(operationId);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockOperation(transaction, `market:${listingId}`);
      const buyer = await this.requireCharacter(transaction, userId, buyerCharacterId);
      const listing = await transaction.itemMarketListing.findUnique({ where: { id: listingId } });
      if (!listing || listing.status !== 'ACTIVE') this.invalid({ listingId });
      if (listing.sellerCharacterId === buyerCharacterId) {
        this.invalid({ listingId, reason: 'MARKET_SELF_TRADE' });
      }
      if (listing.expiresAt.getTime() <= Date.now()) {
        await this.returnListing(transaction, listing, 'EXPIRED', normalizedOperationId);
        this.invalid({ listingId, reason: 'MARKET_LISTING_EXPIRED' });
      }
      const buyerLedgerId = `market-buy:${normalizedOperationId}`;
      const repeated = await transaction.characterCurrencyLedger.findUnique({
        where: {
          characterId_operationId: {
            characterId: buyerCharacterId,
            operationId: buyerLedgerId,
          },
        },
      });
      if (repeated) return;
      const seller = await transaction.character.findUniqueOrThrow({
        where: { id: listing.sellerCharacterId },
        select: { id: true, silver: true },
      });
      const definition = await transaction.itemDefinition.findUniqueOrThrow({
        where: { id: listing.itemDefinitionId },
      });
      const metadata = parseItemDefinitionMetadata(definition.metadata);
      const snapshot = readItemInstanceSnapshot({
        instanceData: listing.instanceData,
        definitionKey: definition.key,
        metadata,
      });
      const buyerSilver = this.debitSilver(buyer.silver, listing.priceSilver);
      const commission = Math.max(1, Math.floor(listing.priceSilver * MARKET_COMMISSION_RATE));
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
      await transaction.characterCurrencyLedger.create({
        data: {
          characterId: buyerCharacterId,
          operationId: buyerLedgerId,
          currency: 'SILVER',
          direction: 'DEBIT',
          amount: listing.priceSilver,
          reason: 'MARKET_PURCHASE',
          balanceAfter: buyerSilver,
          metadata: { listingId, sellerCharacterId: seller.id, commission },
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
      await this.inventory.grant(transaction, {
        characterId: buyerCharacterId,
        definition,
        quantity: listing.quantity,
        snapshot: this.transferSnapshot(snapshot, seller.id, buyerCharacterId, normalizedOperationId),
        operationId: `market-delivery:${listing.id}`,
        reason: `MARKET:${listing.id}`,
      });
      await transaction.itemMarketListing.update({
        where: { id: listing.id },
        data: {
          status: 'SOLD',
          buyerCharacterId,
          closedAt: new Date(),
        },
      });
      await transaction.itemMarketPriceSample.create({
        data: {
          listingId: listing.id,
          itemDefinitionKey: definition.key,
          unitPriceSilver: Math.floor(listing.priceSilver / listing.quantity),
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
        metadata: { listingId, sellerCharacterId: seller.id, commission },
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
    });
    return this.snapshot(userId, buyerCharacterId);
  }

  async cancelMarketListing(
    userId: string,
    characterId: string,
    listingId: string,
    operationId: string,
  ) {
    const normalizedOperationId = this.operationId(operationId);
    await this.prisma.$transaction(async (transaction) => {
      await this.lockOperation(transaction, `market:${listingId}`);
      await this.requireCharacter(transaction, userId, characterId);
      const listing = await transaction.itemMarketListing.findFirst({
        where: { id: listingId, sellerCharacterId: characterId },
      });
      if (!listing || listing.status !== 'ACTIVE') this.invalid({ listingId });
      await this.returnListing(transaction, listing, 'CANCELLED', normalizedOperationId);
    });
    return this.snapshot(userId, characterId);
  }

  async expireMarketListings(limit = 100): Promise<number> {
    const listings = await this.prisma.itemMarketListing.findMany({
      where: { status: 'ACTIVE', expiresAt: { lte: new Date() } },
      orderBy: { expiresAt: 'asc' },
      take: Math.max(1, Math.min(500, Math.trunc(limit))),
    });
    let expired = 0;
    for (const listing of listings) {
      await this.prisma.$transaction(async (transaction) => {
        await this.lockOperation(transaction, `market:${listing.id}`);
        const current = await transaction.itemMarketListing.findUnique({ where: { id: listing.id } });
        if (!current || current.status !== 'ACTIVE' || current.expiresAt.getTime() > Date.now()) return;
        await this.returnListing(transaction, current, 'EXPIRED', `expire:${current.id}`);
        expired += 1;
      });
    }
    return expired;
  }

  async market(itemKey?: string) {
    const definition = itemKey
      ? await this.prisma.itemDefinition.findUnique({ where: { key: itemKey } })
      : undefined;
    const listings = await this.prisma.itemMarketListing.findMany({
      where: {
        status: 'ACTIVE',
        expiresAt: { gt: new Date() },
        itemDefinitionId: definition?.id,
      },
      orderBy: [{ priceSilver: 'asc' }, { createdAt: 'asc' }],
      take: 100,
    });
    const definitions = await this.prisma.itemDefinition.findMany({
      where: { id: { in: [...new Set(listings.map((listing) => listing.itemDefinitionId))] } },
      select: { id: true, key: true, name: true, metadata: true },
    });
    const byId = new Map(definitions.map((entry) => [entry.id, entry]));
    return Promise.all(listings.map(async (listing) => {
      const item = byId.get(listing.itemDefinitionId)!;
      return {
        id: listing.id,
        sellerCharacterId: listing.sellerCharacterId,
        itemDefinitionKey: item.key,
        itemName: item.name,
        rarity: parseItemDefinitionMetadata(item.metadata).rarity,
        quantity: listing.quantity,
        priceSilver: listing.priceSilver,
        expiresAt: listing.expiresAt.getTime(),
        historicalMedianSilver: await this.marketMedian(item.key),
      };
    }));
  }

  async claims(userId: string, characterId: string) {
    await this.assertOwnedCharacter(userId, characterId);
    const claims = await this.inventory.listOpenClaims(characterId);
    const definitions = await this.prisma.itemDefinition.findMany({
      where: { id: { in: [...new Set(claims.map((claim) => claim.itemDefinitionId))] } },
      select: { id: true, key: true, name: true },
    });
    const byId = new Map(definitions.map((definition) => [definition.id, definition]));
    return claims.map((claim) => ({
      id: claim.id,
      itemDefinitionKey: byId.get(claim.itemDefinitionId)?.key ?? 'unknown',
      itemName: byId.get(claim.itemDefinitionId)?.name ?? 'Unknown item',
      quantity: claim.quantity,
      reason: claim.reason,
      expiresAt: claim.expiresAt.getTime(),
    }));
  }

  async claim(
    userId: string,
    characterId: string,
    claimId: string,
    operationId: string,
  ) {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      await this.requireCharacter(transaction, userId, characterId);
      await this.inventory.claim(transaction, {
        characterId,
        claimId,
        operationId: this.operationId(operationId),
      });
    });
    return this.snapshot(userId, characterId);
  }

  async snapshot(userId: string, characterId: string) {
    await this.assertOwnedCharacter(userId, characterId);
    const [character, claims, orders, listings] = await Promise.all([
      this.prisma.character.findUniqueOrThrow({
        where: { id: characterId },
        select: { silver: true },
      }),
      this.claims(userId, characterId),
      this.prisma.itemCraftOrder.findMany({
        where: {
          OR: [{ ownerCharacterId: characterId }, { crafterCharacterId: characterId }],
          status: { in: ['OPEN', 'COMPLETED'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      this.prisma.itemMarketListing.findMany({
        where: { sellerCharacterId: characterId, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' },
        take: MARKET_ACTIVE_LISTING_LIMIT,
      }),
    ]);
    return {
      silver: character.silver,
      recipes: this.recipes(),
      claims,
      craftOrders: orders.map((order) => ({
        id: order.id,
        recipeKey: order.recipeKey,
        recipeVersion: order.recipeVersion,
        ownerCharacterId: order.ownerCharacterId,
        crafterCharacterId: order.crafterCharacterId ?? undefined,
        status: order.status,
        silverEscrow: order.silverEscrow,
        expiresAt: order.expiresAt.getTime(),
        createdAt: order.createdAt.getTime(),
      })),
      listings: listings.map((listing) => ({
        id: listing.id,
        quantity: listing.quantity,
        priceSilver: listing.priceSilver,
        listingFeeSilver: listing.listingFeeSilver,
        expiresAt: listing.expiresAt.getTime(),
      })),
    };
  }

  private async getCraftOrder(userId: string, characterId: string, orderId: string) {
    await this.assertOwnedCharacter(userId, characterId);
    const order = await this.prisma.itemCraftOrder.findFirst({
      where: { id: orderId, ownerCharacterId: characterId },
    });
    if (!order) this.invalid({ orderId });
    return {
      id: order.id,
      recipeKey: order.recipeKey,
      recipeVersion: order.recipeVersion,
      ownerCharacterId: order.ownerCharacterId,
      crafterCharacterId: order.crafterCharacterId ?? undefined,
      status: order.status,
      silverEscrow: order.silverEscrow,
      expiresAt: order.expiresAt.getTime(),
      createdAt: order.createdAt.getTime(),
    };
  }

  private async getMarketListing(listingId: string) {
    const listing = await this.prisma.itemMarketListing.findUniqueOrThrow({
      where: { id: listingId },
    });
    const definition = await this.prisma.itemDefinition.findUniqueOrThrow({
      where: { id: listing.itemDefinitionId },
    });
    return {
      id: listing.id,
      sellerCharacterId: listing.sellerCharacterId,
      itemDefinitionKey: definition.key,
      itemName: definition.name,
      rarity: parseItemDefinitionMetadata(definition.metadata).rarity,
      quantity: listing.quantity,
      priceSilver: listing.priceSilver,
      listingFeeSilver: listing.listingFeeSilver,
      status: listing.status,
      expiresAt: listing.expiresAt.getTime(),
      historicalMedianSilver: await this.marketMedian(definition.key),
    };
  }

  private async marketMedian(itemDefinitionKey: string): Promise<number | undefined> {
    const samples = await this.prisma.itemMarketPriceSample.findMany({
      where: { itemDefinitionKey },
      orderBy: { unitPriceSilver: 'asc' },
      take: 101,
      select: { unitPriceSilver: true },
    });
    if (samples.length === 0) return undefined;
    return samples[Math.floor(samples.length / 2)]!.unitPriceSilver;
  }

  private async refundCraftOrder(
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
    operationId: string,
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
          operationId: `${operationId}:${definition.key}`,
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
        silverEscrow: 0,
        inputEscrow: [],
        cancelledAt: new Date(),
      },
    });
    await this.inventory.recordEvent(transaction, {
      characterId: order.ownerCharacterId,
      operationId,
      eventType: `CRAFT_ORDER_${status}`,
      quantity: 0,
      silverDelta: order.silverEscrow,
      metadata: { orderId: order.id, refundedInputs: escrow },
    });
  }

  private async returnListing(
    transaction: Prisma.TransactionClient,
    listing: {
      id: string;
      sellerCharacterId: string;
      itemDefinitionId: string;
      quantity: number;
      instanceData: Prisma.JsonValue;
      listingFeeSilver: number;
    },
    status: 'CANCELLED' | 'EXPIRED',
    operationId: string,
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
      operationId,
      eventType: `MARKET_${status}`,
      itemDefinitionKey: definition.key,
      quantity: listing.quantity,
      metadata: {
        listingId: listing.id,
        returnedExactly: true,
        listingFeeRefunded: false,
        listingFeeSilver: listing.listingFeeSilver,
      },
    });
  }

  private async grantMaterial(
    transaction: Prisma.TransactionClient,
    characterId: string,
    itemKey: string,
    quantity: number,
    operationId: string,
    sourceKey: string,
  ): Promise<void> {
    const definition = await transaction.itemDefinition.findUnique({ where: { key: itemKey } });
    if (!definition) throw new Error(`SALVAGE_OUTPUT_MISSING:${itemKey}`);
    const metadata = parseItemDefinitionMetadata(definition.metadata);
    const snapshot = createItemInstanceSnapshot({
      definitionKey: definition.key,
      metadata,
      seed: `${operationId}:${itemKey}`,
      origin: this.origin({ source: 'SALVAGE', sourceKey, operationId }),
    });
    await this.inventory.grant(transaction, {
      characterId,
      definition,
      quantity,
      snapshot,
      operationId: `${operationId}:${itemKey}`,
      reason: `SALVAGE:${sourceKey}`,
    });
  }

  private async recordConsumedInputs(
    transaction: Prisma.TransactionClient,
    characterId: string,
    operationId: string,
    recipe: ItemRecipeDefinition,
  ): Promise<void> {
    for (const input of recipe.inputs) {
      await this.inventory.recordEvent(transaction, {
        characterId,
        operationId: `${operationId}:${input.itemKey}`,
        eventType: 'CRAFT_INPUT_CONSUMED',
        itemDefinitionKey: input.itemKey,
        quantity: input.quantity,
        metadata: { recipeKey: recipe.key, recipeVersion: recipe.version },
      });
    }
  }

  private craftedSnapshot(input: {
    definitionKey: string;
    metadata: ReturnType<typeof parseItemDefinitionMetadata>;
    characterId: string;
    operationId: string;
    recipe: ItemRecipeDefinition;
    crafterCharacterId: string;
  }): ItemInstanceSnapshot {
    return createItemInstanceSnapshot({
      definitionKey: input.definitionKey,
      metadata: input.metadata,
      seed: `${input.recipe.deterministicSeedSalt}:${input.characterId}:${input.operationId}`,
      craftQuality: 70,
      origin: this.origin({
        source: 'CRAFT',
        sourceKey: input.recipe.key,
        operationId: input.operationId,
        recipeKey: input.recipe.key,
        recipeVersion: input.recipe.version,
        crafterCharacterId: input.crafterCharacterId,
      }),
    });
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
        !Number.isInteger(input.quantity) ||
        Number(input.quantity) < 1
      ) {
        throw new Error('CRAFT_ESCROW_INVALID');
      }
      return {
        itemDefinitionId: input.itemDefinitionId,
        itemKey: input.itemKey,
        quantity: Number(input.quantity),
      };
    });
  }

  private requireRecipe(recipeKey: string): ItemRecipeDefinition {
    const recipe = ITEM_RECIPES[recipeKey];
    if (!recipe) this.invalid({ recipeKey });
    return recipe;
  }

  private assertRecipeAccess(
    character: { level: number; map: { key: string } },
    recipe: ItemRecipeDefinition,
  ): void {
    if (character.level < recipe.requiredLevel) {
      this.invalid({ recipeKey: recipe.key, requiredLevel: recipe.requiredLevel });
    }
    if (recipe.regionKey && character.map.key !== recipe.regionKey) {
      this.invalid({ recipeKey: recipe.key, requiredRegion: recipe.regionKey });
    }
  }

  private async requireCharacter(
    transaction: Prisma.TransactionClient,
    userId: string,
    characterId: string,
  ) {
    const character = await transaction.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true, level: true, silver: true, map: { select: { key: true } } },
    });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    return character;
  }

  private async assertOwnedCharacter(userId: string, characterId: string): Promise<void> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, userId },
      select: { id: true },
    });
    if (!character) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
  }

  private debitSilver(current: number, amount: number): number {
    this.positiveSilver(amount, true);
    if (current < amount) {
      throw new GameError(GAME_ERROR_CODES.INSUFFICIENT_SILVER, 'errors.items.insufficientSilver', {
        required: amount,
        available: current,
      });
    }
    return current - amount;
  }

  private positiveSilver(value: number, allowZero = false): void {
    if (!Number.isInteger(value) || value < (allowZero ? 0 : 1) || value > 2_147_483_647) {
      this.invalid();
    }
  }

  private operationId(value: string): string {
    const normalized = value.trim();
    if (!normalized || normalized.length > 96) this.invalid();
    return normalized;
  }

  private deterministicRoll(seed: string): number {
    return createHash('sha256').update(seed).digest().readUInt32BE(0) / 0x1_0000_0000;
  }

  private origin(
    input: Omit<ItemOriginSnapshot, 'contentVersion' | 'generatedAt'>,
  ): ItemOriginSnapshot {
    return { ...input, contentVersion: 1, generatedAt: new Date().toISOString() };
  }

  private json(value: unknown): Prisma.InputJsonValue {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
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

  private invalid(details?: Record<string, unknown>): never {
    throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', details);
  }
}
