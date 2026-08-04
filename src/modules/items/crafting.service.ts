import { Injectable, type OnModuleInit } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { NpcService } from '../npcs/npc.service.js';
import {
  CRAFT_ORDER_ACTIVE_LIMIT,
  CRAFT_ORDER_MAX_REWARD_SILVER,
  CRAFT_ORDER_TTL_MS,
  CraftOrderService,
} from './craft-order.service.js';
import type {
  CraftOrderFulfillBlocker,
  CraftOrderMutationResult,
  CraftOrderPayload,
  CraftingOutputPayload,
  CraftingRecipePayload,
  CraftingResult,
  CraftingSnapshot,
  CraftingStationSession,
} from './crafting.contracts.js';
import { ItemEconomyService } from './item-economy.service.js';
import {
  ITEM_CURSES,
  ITEM_RECIPES,
  ITEM_RELICS,
} from './itemization.catalog.js';
import { parseItemDefinitionMetadata } from './itemization.rules.js';
import type { ItemRecipeDefinition } from './itemization.types.js';

const BORIN_KEY = 'quartermaster';
const BORIN_FORGE_KEY = 'quartermaster-forge';
const CRAFT_QUALITY = 70;
const ORDER_BOARD_LIMIT = 100;
const MY_ORDER_HISTORY_LIMIT = 50;

type CraftOrderRecord = {
  id: string;
  ownerCharacterId: string;
  crafterCharacterId: string | null;
  recipeKey: string;
  recipeVersion: number;
  status: 'OPEN' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED';
  silverEscrow: number;
  outputQuantity: number;
  expiresAt: Date;
  createdAt: Date;
  completedAt: Date | null;
  cancelledAt: Date | null;
};

@Injectable()
export class CraftingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly economy: ItemEconomyService,
    private readonly craftOrders: CraftOrderService,
    private readonly npcs: NpcService,
  ) {}

  async onModuleInit(): Promise<void> {
    const quartermasters = await this.prisma.npcDefinition.findMany({
      where: { key: BORIN_KEY },
      select: { id: true, dialogue: true },
    });
    let changed = false;
    for (const quartermaster of quartermasters) {
      const patched = this.withCraftingChoice(quartermaster.dialogue);
      if (!patched) continue;
      await this.prisma.npcDefinition.update({
        where: { id: quartermaster.id },
        data: { dialogue: patched },
      });
      changed = true;
    }
    if (changed) this.npcs.clearMapCache();
  }

  assertStationRecipe(workstationKey: string, recipeKey: string): ItemRecipeDefinition {
    const recipe = this.requireRecipe(recipeKey);
    if (!recipe.workstationKey || recipe.workstationKey !== workstationKey) {
      this.invalid({
        recipeKey,
        requiredWorkstation: recipe.workstationKey,
        activeWorkstation: workstationKey,
      });
    }
    return recipe;
  }

  async getSnapshot(
    userId: string,
    characterId: string,
    station: CraftingStationSession,
    npcName: string,
  ): Promise<CraftingSnapshot> {
    await this.craftOrders.expireOrders(50);
    const recipes = Object.values(ITEM_RECIPES).filter(
      (recipe) => recipe.workstationKey === station.workstationKey,
    );
    const recipeKeys = recipes.map((recipe) => recipe.key);
    const definitionKeys = [
      ...new Set(
        recipes.flatMap((recipe) => [
          recipe.outputItemKey,
          ...recipe.inputs.map((input) => input.itemKey),
        ]),
      ),
    ];
    const [character, definitions, inventoryItems] = await Promise.all([
      this.prisma.character.findFirst({
        where: { id: characterId, userId },
        select: {
          id: true,
          name: true,
          realmId: true,
          level: true,
          silver: true,
          map: { select: { key: true } },
        },
      }),
      this.prisma.itemDefinition.findMany({
        where: { key: { in: definitionKeys } },
        select: {
          key: true,
          name: true,
          description: true,
          metadata: true,
        },
      }),
      this.prisma.inventoryItem.findMany({
        where: {
          characterId,
          equippedSlot: null,
          tradeOfferItems: { none: {} },
          itemDefinition: { key: { in: definitionKeys } },
        },
        select: {
          quantity: true,
          itemDefinition: { select: { key: true } },
        },
      }),
    ]);
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }

    const realmCharacters = await this.prisma.character.findMany({
      where: { realmId: character.realmId },
      select: { id: true, name: true },
    });
    const realmCharacterIds = realmCharacters.map((entry) => entry.id);
    const namesByCharacterId = new Map(
      realmCharacters.map((entry) => [entry.id, entry.name]),
    );
    const now = new Date();
    const [boardRecords, mineRecords] = await Promise.all([
      this.prisma.itemCraftOrder.findMany({
        where: {
          ownerCharacterId: { in: realmCharacterIds },
          recipeKey: { in: recipeKeys },
          status: 'OPEN',
          expiresAt: { gt: now },
        },
        orderBy: { createdAt: 'desc' },
        take: ORDER_BOARD_LIMIT,
      }),
      this.prisma.itemCraftOrder.findMany({
        where: {
          ownerCharacterId: characterId,
          recipeKey: { in: recipeKeys },
        },
        orderBy: { createdAt: 'desc' },
        take: MY_ORDER_HISTORY_LIMIT,
      }),
    ]);
    const activeOrderCount = mineRecords.filter(
      (order) => order.status === 'OPEN' && order.expiresAt.getTime() > Date.now(),
    ).length;

    const definitionsByKey = new Map(definitions.map((definition) => [definition.key, definition]));
    const ownedByKey = new Map<string, number>();
    for (const item of inventoryItems) {
      const key = item.itemDefinition.key;
      ownedByKey.set(key, (ownedByKey.get(key) ?? 0) + item.quantity);
    }

    const recipePayloads = recipes.map((recipe) => {
      const outputDefinition = definitionsByKey.get(recipe.outputItemKey);
      if (!outputDefinition) {
        throw new Error(`CRAFT_OUTPUT_DEFINITION_MISSING:${recipe.outputItemKey}`);
      }
      const outputMetadata = parseItemDefinitionMetadata(outputDefinition.metadata);
      const inputs = recipe.inputs.map((input) => {
        const definition = definitionsByKey.get(input.itemKey);
        if (!definition) throw new Error(`CRAFT_INPUT_DEFINITION_MISSING:${input.itemKey}`);
        const metadata = parseItemDefinitionMetadata(definition.metadata);
        const ownedQuantity = ownedByKey.get(input.itemKey) ?? 0;
        return {
          itemKey: input.itemKey,
          name: definition.name,
          icon: metadata.icon,
          requiredQuantity: input.quantity,
          ownedQuantity,
          enough: ownedQuantity >= input.quantity,
        };
      });
      const mechanics = outputMetadata.mechanics;
      const relic = mechanics?.relicKey ? ITEM_RELICS[mechanics.relicKey] : undefined;
      const curse = mechanics?.curseKey ? ITEM_CURSES[mechanics.curseKey] : undefined;
      const levelMet = character.level >= recipe.requiredLevel;
      const regionMet = !recipe.regionKey || character.map.key === recipe.regionKey;
      const workstationMet = recipe.workstationKey === station.workstationKey;
      const silverMet = character.silver >= recipe.silverCost;
      const materialsMet = inputs.every((input) => input.enough);
      const activeOrderLimitMet = activeOrderCount < CRAFT_ORDER_ACTIVE_LIMIT;
      const payload: CraftingRecipePayload = {
        key: recipe.key,
        version: recipe.version,
        name: recipe.name,
        outputQuantity: recipe.outputQuantity,
        silverCost: recipe.silverCost,
        requiredLevel: recipe.requiredLevel,
        workstationKey: recipe.workstationKey,
        regionKey: recipe.regionKey,
        complexity: recipe.specializationCost,
        craftQuality: CRAFT_QUALITY,
        inputs,
        output: {
          definitionKey: outputDefinition.key,
          name: outputDefinition.name,
          description: outputDefinition.description,
          icon: outputMetadata.icon,
          category: outputMetadata.category,
          rarity: outputMetadata.rarity,
          equipmentSlot: outputMetadata.equipmentSlot,
          requiredClass: outputMetadata.requiredClass,
          minimumLevel: outputMetadata.minimumLevel ?? 1,
          statBonuses: { ...(outputMetadata.statBonuses ?? {}) },
          affixCount: mechanics?.affixCount ? { ...mechanics.affixCount } : undefined,
          relic: relic
            ? {
                key: relic.key,
                name: relic.name,
                description: relic.description,
              }
            : undefined,
          curse: curse
            ? {
                key: curse.key,
                name: curse.name,
                description: curse.description,
                preview: curse.preview,
              }
            : undefined,
        },
        availability: {
          levelMet,
          regionMet,
          workstationMet,
          silverMet,
          materialsMet,
          canCraft: levelMet && regionMet && workstationMet && silverMet && materialsMet,
        },
        orderAvailability: {
          regionMet,
          workstationMet,
          baseSilverMet: silverMet,
          materialsMet,
          activeOrderLimitMet,
          canCreate:
            regionMet &&
            workstationMet &&
            silverMet &&
            materialsMet &&
            activeOrderLimitMet,
        },
      };
      return payload;
    });
    const recipePayloadByKey = new Map(recipePayloads.map((recipe) => [recipe.key, recipe]));
    const board = boardRecords
      .map((order) =>
        this.orderPayload(
          order,
          character,
          station,
          namesByCharacterId,
          recipePayloadByKey,
        ),
      )
      .filter((order): order is CraftOrderPayload => Boolean(order))
      .sort(
        (left, right) =>
          right.rewardSilver - left.rewardSilver || left.expiresAt - right.expiresAt,
      );
    const mine = mineRecords
      .map((order) =>
        this.orderPayload(
          order,
          character,
          station,
          namesByCharacterId,
          recipePayloadByKey,
        ),
      )
      .filter((order): order is CraftOrderPayload => Boolean(order));

    return {
      station: {
        npcId: station.npcId,
        npcName,
        workstationKey: station.workstationKey,
      },
      characterLevel: character.level,
      mapKey: character.map.key,
      silver: character.silver,
      recipes: recipePayloads,
      orders: {
        rules: {
          activeOrderLimit: CRAFT_ORDER_ACTIVE_LIMIT,
          activeOrderCount,
          maximumRewardSilver: CRAFT_ORDER_MAX_REWARD_SILVER,
          ttlMs: CRAFT_ORDER_TTL_MS,
        },
        board,
        mine,
      },
    };
  }

  async craft(
    userId: string,
    characterId: string,
    station: CraftingStationSession,
    npcName: string,
    recipeKey: string,
    operationId: string,
  ): Promise<CraftingResult> {
    const recipe = this.assertStationRecipe(station.workstationKey, recipeKey);
    await this.economy.craft(userId, characterId, recipe.key, operationId);
    const overflowClaim = await this.prisma.itemClaim.findFirst({
      where: {
        characterId,
        operationId: { startsWith: `craft-output:${operationId}:claim` },
      },
      select: { id: true },
    });
    const snapshot = await this.getSnapshot(userId, characterId, station, npcName);
    const output = snapshot.recipes.find((candidate) => candidate.key === recipe.key)?.output;
    if (!output) throw new Error(`CRAFT_OUTPUT_PAYLOAD_MISSING:${recipe.outputItemKey}`);
    return {
      snapshot,
      crafted: {
        recipeKey: recipe.key,
        definitionKey: output.definitionKey,
        name: output.name,
        quantity: recipe.outputQuantity,
        delivery: overflowClaim ? 'CLAIMS' : 'INVENTORY',
      },
    };
  }

  async createOrder(
    userId: string,
    characterId: string,
    station: CraftingStationSession,
    npcName: string,
    recipeKey: string,
    rewardSilver: number,
    operationId: string,
  ): Promise<CraftOrderMutationResult> {
    const recipe = this.assertStationRecipe(station.workstationKey, recipeKey);
    const orderId = await this.craftOrders.create(
      userId,
      characterId,
      recipe.key,
      rewardSilver,
      operationId,
    );
    const snapshot = await this.getSnapshot(userId, characterId, station, npcName);
    const output = snapshot.recipes.find((candidate) => candidate.key === recipe.key)?.output;
    if (!output) throw new Error(`CRAFT_OUTPUT_PAYLOAD_MISSING:${recipe.outputItemKey}`);
    return {
      snapshot,
      mutation: {
        kind: 'CREATED',
        orderId,
        outputName: output.name,
        rewardSilver,
        ownerCharacterId: characterId,
      },
    };
  }

  async fulfillOrder(
    userId: string,
    characterId: string,
    station: CraftingStationSession,
    npcName: string,
    orderId: string,
    operationId: string,
  ): Promise<CraftOrderMutationResult> {
    const order = await this.requireOrder(orderId);
    const recipe = this.assertStationRecipe(station.workstationKey, order.recipeKey);
    const fulfillment = await this.craftOrders.fulfill(
      userId,
      characterId,
      orderId,
      operationId,
    );
    const snapshot = await this.getSnapshot(userId, characterId, station, npcName);
    const output = snapshot.recipes.find((candidate) => candidate.key === recipe.key)?.output;
    if (!output) throw new Error(`CRAFT_OUTPUT_PAYLOAD_MISSING:${recipe.outputItemKey}`);
    return {
      snapshot,
      mutation: {
        kind: 'FULFILLED',
        orderId,
        outputName: output.name,
        rewardSilver: fulfillment.rewardSilver,
        ownerCharacterId: fulfillment.ownerCharacterId,
        delivery: fulfillment.delivery,
      },
    };
  }

  async cancelOrder(
    userId: string,
    characterId: string,
    station: CraftingStationSession,
    npcName: string,
    orderId: string,
  ): Promise<CraftOrderMutationResult> {
    const order = await this.requireOrder(orderId);
    const recipe = this.assertStationRecipe(station.workstationKey, order.recipeKey);
    const rewardSilver = this.craftOrders.rewardForEscrow(order.silverEscrow, recipe.key);
    await this.craftOrders.cancel(userId, characterId, orderId);
    const snapshot = await this.getSnapshot(userId, characterId, station, npcName);
    const output = snapshot.recipes.find((candidate) => candidate.key === recipe.key)?.output;
    if (!output) throw new Error(`CRAFT_OUTPUT_PAYLOAD_MISSING:${recipe.outputItemKey}`);
    return {
      snapshot,
      mutation: {
        kind: 'CANCELLED',
        orderId,
        outputName: output.name,
        rewardSilver,
        ownerCharacterId: characterId,
      },
    };
  }

  private orderPayload(
    order: CraftOrderRecord,
    character: { id: string; level: number; map: { key: string } },
    station: CraftingStationSession,
    namesByCharacterId: ReadonlyMap<string, string>,
    recipesByKey: ReadonlyMap<string, CraftingRecipePayload>,
  ): CraftOrderPayload | undefined {
    const recipe = recipesByKey.get(order.recipeKey);
    if (!recipe) return undefined;
    const open = order.status === 'OPEN' && order.expiresAt.getTime() > Date.now();
    const blockers: CraftOrderFulfillBlocker[] = [];
    if (!open) blockers.push('ORDER_CLOSED');
    if (order.ownerCharacterId === character.id) blockers.push('OWN_ORDER');
    if (order.recipeVersion !== recipe.version) blockers.push('RECIPE_VERSION_MISMATCH');
    if (character.level < recipe.requiredLevel) blockers.push('LEVEL_REQUIRED');
    if (recipe.regionKey && character.map.key !== recipe.regionKey) {
      blockers.push('REGION_REQUIRED');
    }
    if (recipe.workstationKey !== station.workstationKey) {
      blockers.push('WRONG_WORKSTATION');
    }
    const rewardSilver = this.craftOrders.rewardForEscrow(
      order.silverEscrow,
      recipe.key,
    );
    return {
      id: order.id,
      recipeKey: order.recipeKey,
      recipeVersion: order.recipeVersion,
      recipeName: recipe.name,
      owner: {
        characterId: order.ownerCharacterId,
        name: namesByCharacterId.get(order.ownerCharacterId) ?? 'Unknown player',
      },
      crafter: order.crafterCharacterId
        ? {
            characterId: order.crafterCharacterId,
            name: namesByCharacterId.get(order.crafterCharacterId) ?? 'Unknown player',
          }
        : undefined,
      output: this.cloneOutput(recipe.output),
      outputQuantity: order.outputQuantity,
      requiredLevel: recipe.requiredLevel,
      craftCostSilver: recipe.silverCost,
      rewardSilver,
      totalEscrowSilver: order.silverEscrow,
      status: order.status,
      createdAt: order.createdAt.getTime(),
      expiresAt: order.expiresAt.getTime(),
      completedAt: order.completedAt?.getTime(),
      cancelledAt: order.cancelledAt?.getTime(),
      canFulfill: blockers.length === 0,
      canCancel: open && order.ownerCharacterId === character.id,
      fulfillBlockers: blockers,
    };
  }

  private cloneOutput(output: CraftingOutputPayload): CraftingOutputPayload {
    return {
      ...output,
      statBonuses: { ...output.statBonuses },
      affixCount: output.affixCount ? { ...output.affixCount } : undefined,
      relic: output.relic ? { ...output.relic } : undefined,
      curse: output.curse ? { ...output.curse } : undefined,
    };
  }

  private async requireOrder(orderId: string) {
    const order = await this.prisma.itemCraftOrder.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        recipeKey: true,
        silverEscrow: true,
      },
    });
    if (!order) this.invalid({ orderId });
    return order;
  }

  private requireRecipe(recipeKey: string): ItemRecipeDefinition {
    const recipe = ITEM_RECIPES[recipeKey];
    if (!recipe) this.invalid({ recipeKey });
    return recipe;
  }

  private withCraftingChoice(value: Prisma.JsonValue): Prisma.InputJsonValue | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const dialogue = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
    const nodes = dialogue.nodes;
    if (!nodes || typeof nodes !== 'object' || Array.isArray(nodes)) return undefined;
    const welcome = (nodes as Record<string, unknown>).welcome;
    if (!welcome || typeof welcome !== 'object' || Array.isArray(welcome)) return undefined;
    const choices = (welcome as Record<string, unknown>).choices;
    if (!Array.isArray(choices)) return undefined;

    const withoutCrafting = choices.filter(
      (choice) =>
        !choice ||
        typeof choice !== 'object' ||
        Array.isArray(choice) ||
        (choice as Record<string, unknown>).id !== 'open-crafting',
    );
    const craftingChoice = {
      id: 'open-crafting',
      label: {
        pl: 'Chcę skorzystać z kuźni.',
        en: 'I want to use the forge.',
      },
      action: 'OPEN_CRAFTING',
    };
    const declineIndex = withoutCrafting.findIndex(
      (choice) =>
        choice &&
        typeof choice === 'object' &&
        !Array.isArray(choice) &&
        (choice as Record<string, unknown>).action === 'CLOSE',
    );
    if (declineIndex >= 0) withoutCrafting.splice(declineIndex, 0, craftingChoice);
    else withoutCrafting.push(craftingChoice);

    (welcome as Record<string, unknown>).choices = withoutCrafting;
    dialogue.crafting = { workstationKey: BORIN_FORGE_KEY };
    return dialogue as Prisma.InputJsonValue;
  }

  private invalid(details?: Record<string, unknown>): never {
    throw new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', details);
  }
}
