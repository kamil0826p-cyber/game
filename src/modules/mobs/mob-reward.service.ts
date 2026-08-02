import { Injectable, Optional } from '@nestjs/common';
import type { CharacterClass, EquipmentSlot } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { ItemRarity, ItemStatBonuses } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { CharacterProgressionService } from '../characters/progression/character-progression.service.js';
import { calculateGuildExperienceReward } from '../guilds/guild.rules.js';
import { ItemInventoryService } from '../items/item-inventory.service.js';
import {
  createItemInstanceSnapshot,
  parseItemDefinitionMetadata,
} from '../items/itemization.rules.js';
import { QuestService } from '../quests/quest.service.js';
import { skillPointsGainedBetweenLevels } from '../skills/skill.rules.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { applyExperience } from './character-progression.js';
import { canReceiveMobExperience } from './mob-reward.rules.js';
import { rollMobLoot, type AwardedLoot } from './mob-rewards.js';
import type { RuntimeMob } from './mob.types.js';

type RewardItemMetadata = {
  rarity?: ItemRarity;
  icon?: string;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel?: number;
  statBonuses?: ItemStatBonuses;
  effect?: { hp?: number; energy?: number };
};

export interface SettledLoot {
  itemKey: string;
  name: string;
  description: string;
  rarity: ItemRarity;
  icon: string;
  quantity: number;
  stackLimit: number;
  equipmentSlot?: EquipmentSlot;
  requiredClass?: CharacterClass;
  minimumLevel: number;
  statBonuses: ItemStatBonuses;
  effect?: { hp?: number; energy?: number };
}

export interface MobRewardSettlement {
  experienceGained: number;
  levelsGained: number;
  skillPointsGained: number;
  nextLevelExperience: number | null;
  loot: SettledLoot[];
  skippedLoot: SettledLoot[];
  claimQueuedLoot: SettledLoot[];
}

export interface EncounterRewardContext {
  combatId: string;
  operationId: string;
  encounterKey: string;
}

@Injectable()
export class MobRewardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly characterProgression: CharacterProgressionService,
    private readonly inventory: ItemInventoryService,
    @Optional() private readonly quests?: QuestService,
  ) {}

  async award(
    session: PlayerSession,
    mob: RuntimeMob,
    context?: EncounterRewardContext,
  ): Promise<MobRewardSettlement> {
    const result = await this.prisma.$transaction(async (transaction) => {
      const owner = await transaction.character.findUnique({
        where: { id: session.characterId },
        select: { id: true, userId: true },
      });
      if (!owner || owner.userId !== session.userId) {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }

      if (context) {
        const existing = await transaction.encounterRewardLedger.findUnique({
          where: {
            characterId_operationId: {
              characterId: owner.id,
              operationId: context.operationId,
            },
          },
          select: { combatId: true, encounterKey: true, settlement: true },
        });
        if (existing) {
          if (
            existing.combatId !== context.combatId ||
            existing.encounterKey !== context.encounterKey
          ) {
            throw new GameError(GAME_ERROR_CODES.INTERNAL_ERROR, 'errors.internal');
          }
          return {
            duplicate: true as const,
            settlement: this.readEncounterSettlement(existing.settlement),
          };
        }
      }

      const current = await this.characterProgression.recomputeInTransaction(
        transaction,
        owner.id,
      );
      const guildMembership = await transaction.guildMember.findUnique({
        where: { characterId: owner.id },
        select: {
          guildId: true,
          guild: { select: { experienceUpgradeLevel: true } },
        },
      });
      const baseExperienceAward = canReceiveMobExperience(current.level, mob.level)
        ? mob.experience
        : 0;
      const experienceReward = calculateGuildExperienceReward(
        baseExperienceAward,
        guildMembership?.guild.experienceUpgradeLevel ?? 0,
      );
      const progression = applyExperience(
        current.level,
        current.experience,
        experienceReward.totalExperience,
      );
      const skillPointsGained = skillPointsGainedBetweenLevels(
        current.level,
        progression.level,
      );

      await transaction.character.update({
        where: { id: owner.id },
        data: {
          level: progression.level,
          experience: progression.experience,
        },
      });
      if (guildMembership) {
        await transaction.guildMember.update({
          where: { characterId: owner.id },
          data: {
            mobKills: { increment: 1 },
            bonusExperienceEarned: { increment: experienceReward.bonusExperience },
          },
        });
        await transaction.guild.update({
          where: { id: guildMembership.guildId },
          data: {
            mobKills: { increment: 1 },
            bonusExperienceGranted: { increment: experienceReward.bonusExperience },
          },
        });
      }
      const updated = await this.characterProgression.recomputeInTransaction(
        transaction,
        owner.id,
      );
      const rolled = rollMobLoot(mob.loot);
      const rewardOperationId = context?.operationId ?? `mob:${mob.id}:${owner.id}`;
      const loot = await this.grantLoot(
        transaction,
        owner.id,
        rolled,
        rewardOperationId,
        mob.definitionKey,
      );
      const settlement: MobRewardSettlement = {
        experienceGained: experienceReward.totalExperience,
        levelsGained: progression.levelsGained,
        skillPointsGained,
        nextLevelExperience: progression.nextLevelExperience,
        loot: loot.granted,
        skippedLoot: [],
        claimQueuedLoot: loot.claimed,
      };

      if (context) {
        const storedSettlement = JSON.parse(
          JSON.stringify(settlement),
        ) as Prisma.InputJsonValue;
        await transaction.encounterRewardLedger.create({
          data: {
            characterId: owner.id,
            operationId: context.operationId,
            combatId: context.combatId,
            encounterKey: context.encounterKey,
            settlement: storedSettlement,
          },
        });
      }

      return { duplicate: false as const, settlement, updated };
    });

    if (!result.duplicate) {
      Object.assign(session, result.updated);
      session.stateRevision = Math.max(session.stateRevision + 1, result.updated.stateVersion);
      session.persistedRevision = Math.max(session.persistedRevision, result.updated.stateVersion);
      session.dirty = true;
      await this.quests
        ?.recordMobKill(session.characterId, mob.definitionKey)
        .catch(() => undefined);
    }

    return result.settlement;
  }

  private readEncounterSettlement(value: Prisma.JsonValue): MobRewardSettlement {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new GameError(GAME_ERROR_CODES.INTERNAL_ERROR, 'errors.internal');
    }
    const parsed = value as Partial<MobRewardSettlement>;
    if (
      !Number.isInteger(parsed.experienceGained) ||
      !Number.isInteger(parsed.levelsGained) ||
      !Number.isInteger(parsed.skillPointsGained) ||
      !(
        parsed.nextLevelExperience === null ||
        Number.isInteger(parsed.nextLevelExperience)
      ) ||
      !Array.isArray(parsed.loot) ||
      !Array.isArray(parsed.skippedLoot) ||
      !(parsed.claimQueuedLoot === undefined || Array.isArray(parsed.claimQueuedLoot))
    ) {
      throw new GameError(GAME_ERROR_CODES.INTERNAL_ERROR, 'errors.internal');
    }
    return {
      ...(parsed as Omit<MobRewardSettlement, 'claimQueuedLoot'>),
      claimQueuedLoot: parsed.claimQueuedLoot ?? [],
    };
  }

  private async grantLoot(
    transaction: Prisma.TransactionClient,
    characterId: string,
    rewards: readonly AwardedLoot[],
    operationId: string,
    encounterKey: string,
  ): Promise<{ granted: SettledLoot[]; claimed: SettledLoot[] }> {
    if (rewards.length === 0) return { granted: [], claimed: [] };
    const definitions = await transaction.itemDefinition.findMany({
      where: { key: { in: rewards.map((reward) => reward.itemKey) } },
    });
    const definitionsByKey = new Map(
      definitions.map((definition) => [definition.key, definition]),
    );
    const granted: SettledLoot[] = [];
    const claimed: SettledLoot[] = [];

    for (const reward of rewards) {
      const definition = definitionsByKey.get(reward.itemKey);
      if (!definition) continue;
      const metadata = parseItemDefinitionMetadata(definition.metadata);
      const batches = metadata.category === 'EQUIPMENT'
        ? Array.from({ length: reward.quantity }, () => 1)
        : [reward.quantity];
      let grantedQuantity = 0;
      let claimedQuantity = 0;
      for (let index = 0; index < batches.length; index += 1) {
        const quantity = batches[index]!;
        const snapshot = createItemInstanceSnapshot({
          definitionKey: definition.key,
          metadata,
          seed: `${operationId}:${definition.key}:${index}`,
          origin: {
            source: 'LOOT',
            sourceKey: encounterKey,
            operationId: `${operationId}:${definition.key}:${index}`,
            contentVersion: 1,
            generatedAt: new Date().toISOString(),
            encounterKey,
          },
        });
        const result = await this.inventory.grant(transaction, {
          characterId,
          definition,
          quantity,
          snapshot,
          operationId: `${operationId}:${definition.key}:${index}`,
          reason: `ENCOUNTER:${encounterKey}`,
        });
        grantedQuantity += result.grantedQuantity;
        claimedQuantity += result.claimedQuantity;
      }
      if (grantedQuantity > 0) {
        granted.push(this.toSettledLoot(definition, grantedQuantity));
      }
      if (claimedQuantity > 0) {
        claimed.push(this.toSettledLoot(definition, claimedQuantity));
      }
    }
    return { granted, claimed };
  }

  private toSettledLoot(
    definition: {
      key: string;
      name: string;
      description: string;
      stackLimit: number;
      metadata: Prisma.JsonValue;
    },
    quantity: number,
  ): SettledLoot {
    const metadata = parseItemDefinitionMetadata(definition.metadata);
    const rewardMetadata = definition.metadata as unknown as RewardItemMetadata;
    return {
      itemKey: definition.key,
      name: definition.name,
      description: definition.description,
      rarity: metadata.rarity,
      icon: metadata.icon,
      quantity,
      stackLimit: definition.stackLimit,
      equipmentSlot: metadata.equipmentSlot,
      requiredClass: metadata.requiredClass,
      minimumLevel: metadata.minimumLevel ?? 1,
      statBonuses: metadata.statBonuses ?? {},
      effect: rewardMetadata.effect,
    };
  }
}
