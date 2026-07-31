import { Injectable, Optional } from '@nestjs/common';
import type { CharacterClass, EquipmentSlot } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { ItemRarity, ItemStatBonuses } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { TelemetryService } from '../../telemetry/telemetry.service.js';
import { ProgressionService } from '../characters/progression.service.js';
import { INVENTORY_CAPACITY } from '../items/item.service.js';
import { QuestService } from '../quests/quest.service.js';
import { skillsForClass } from '../skills/skill.catalog.js';
import type { PlayerSession } from '../world/player-session.types.js';
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
}

@Injectable()
export class MobRewardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progression: ProgressionService,
    private readonly telemetry: TelemetryService,
    @Optional() private readonly quests?: QuestService,
  ) {}

  async award(session: PlayerSession, mob: RuntimeMob): Promise<MobRewardSettlement> {
    const rolled = rollMobLoot(mob.loot);
    const result = await this.prisma.$transaction(async (transaction) => {
      const character = await transaction.character.findUnique({
        where: { id: session.characterId },
        select: {
          id: true,
          userId: true,
          class: true,
          level: true,
          experience: true,
          hp: true,
          maxHp: true,
          energy: true,
          maxEnergy: true,
          strength: true,
          agility: true,
          intelligence: true,
          armor: true,
        },
      });
      if (!character || character.userId !== session.userId) {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }

      const experienceAward = canReceiveMobExperience(character.level, mob.level)
        ? mob.experience
        : 0;
      const progression = this.progression.applyExperience(
        character.level,
        character.experience,
        experienceAward,
      );
      const actualExperienceGained = Math.max(
        0,
        experienceAward - progression.discardedExperience,
      );
      const characterClass = character.class as CharacterClass;
      const previousBase = this.progression.calculateBaseStats(
        characterClass,
        character.level,
      );
      const nextBase = this.progression.calculateBaseStats(
        characterClass,
        progression.level,
      );
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
      const capacity = skillsForClass(characterClass).reduce(
        (sum, skill) => sum + skill.maxRank,
        0,
      );
      const beforePoints = this.progression.calculateSkillPointBudget(
        character.level,
        0,
        capacity,
      ).earned;
      const afterPoints = this.progression.calculateSkillPointBudget(
        progression.level,
        0,
        capacity,
      ).earned;
      const skillPointsGained = Math.max(0, afterPoints - beforePoints);

      const updated = await transaction.character.update({
        where: { id: character.id },
        data: {
          level: progression.level,
          experience: progression.experience,
          hp: Math.min(maxHp, Math.max(0, character.hp + Math.max(0, growth.maxHp))),
          maxHp,
          energy: Math.min(
            maxEnergy,
            Math.max(0, character.energy + Math.max(0, growth.maxEnergy)),
          ),
          maxEnergy,
          strength: Math.max(0, character.strength + growth.strength),
          agility: Math.max(0, character.agility + growth.agility),
          intelligence: Math.max(0, character.intelligence + growth.intelligence),
          armor: Math.max(0, character.armor + growth.armor),
          stateVersion: { increment: 1 },
          lastSavedAt: new Date(),
        },
        select: {
          level: true,
          experience: true,
          hp: true,
          maxHp: true,
          energy: true,
          maxEnergy: true,
          strength: true,
          agility: true,
          intelligence: true,
          armor: true,
          stateVersion: true,
        },
      });
      const loot = await this.grantLoot(transaction, character.id, rolled);
      return {
        progression,
        skillPointsGained,
        updated,
        actualExperienceGained,
        ...loot,
      };
    });

    Object.assign(session, result.updated);
    session.stateRevision = Math.max(
      session.stateRevision + 1,
      result.updated.stateVersion,
    );
    session.persistedRevision = Math.max(
      session.persistedRevision,
      result.updated.stateVersion,
    );
    session.dirty = false;

    for (const item of result.granted) {
      this.telemetry.emit(
        'item_received',
        {
          userId: session.userId,
          characterId: session.characterId,
          realmId: session.realmId,
        },
        {
          itemKey: item.itemKey,
          quantity: item.quantity,
          source: `mob:${mob.definitionKey}`,
        },
      );
    }
    await this.quests
      ?.recordMobKill(session.characterId, mob.definitionKey)
      .catch(() => undefined);

    return {
      experienceGained: result.actualExperienceGained,
      levelsGained: result.progression.levelsGained,
      skillPointsGained: result.skillPointsGained,
      nextLevelExperience: this.progression.experienceRequiredForNextLevel(
        result.updated.level,
      ),
      loot: result.granted,
      skippedLoot: result.skipped,
    };
  }

  private async grantLoot(
    transaction: Prisma.TransactionClient,
    characterId: string,
    rewards: readonly AwardedLoot[],
  ): Promise<{ granted: SettledLoot[]; skipped: SettledLoot[] }> {
    if (rewards.length === 0) return { granted: [], skipped: [] };
    const definitions = await transaction.itemDefinition.findMany({
      where: { key: { in: rewards.map((reward) => reward.itemKey) } },
    });
    const definitionsByKey = new Map(
      definitions.map((definition) => [definition.key, definition]),
    );
    const items = await transaction.inventoryItem.findMany({
      where: { characterId },
      orderBy: { slotIndex: 'asc' },
    });
    const occupied = new Set(items.map((item) => item.slotIndex));
    const granted: SettledLoot[] = [];
    const skipped: SettledLoot[] = [];

    for (const reward of rewards) {
      const definition = definitionsByKey.get(reward.itemKey);
      if (!definition) continue;
      let remaining = reward.quantity;
      let grantedQuantity = 0;
      const stacks = items.filter(
        (item) =>
          item.itemDefinitionId === definition.id &&
          item.equippedSlot === null &&
          item.quantity < definition.stackLimit,
      );
      for (const stack of stacks) {
        if (remaining <= 0) break;
        const moved = Math.min(remaining, definition.stackLimit - stack.quantity);
        if (moved <= 0) continue;
        await transaction.inventoryItem.update({
          where: { id: stack.id },
          data: { quantity: { increment: moved } },
        });
        stack.quantity += moved;
        remaining -= moved;
        grantedQuantity += moved;
      }
      for (
        let slotIndex = 0;
        slotIndex < INVENTORY_CAPACITY && remaining > 0;
        slotIndex += 1
      ) {
        if (occupied.has(slotIndex)) continue;
        const quantity = Math.min(remaining, definition.stackLimit);
        const created = await transaction.inventoryItem.create({
          data: {
            characterId,
            itemDefinitionId: definition.id,
            quantity,
            slotIndex,
          },
        });
        items.push(created);
        occupied.add(slotIndex);
        remaining -= quantity;
        grantedQuantity += quantity;
      }
      if (grantedQuantity > 0) {
        granted.push(this.toSettledLoot(definition, grantedQuantity));
      }
      if (remaining > 0) skipped.push(this.toSettledLoot(definition, remaining));
    }
    return { granted, skipped };
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
    const metadata = definition.metadata as unknown as RewardItemMetadata;
    const rarity = ['COMMON', 'ARTIFACT', 'MYTHIC'].includes(String(metadata.rarity))
      ? (metadata.rarity as ItemRarity)
      : 'COMMON';
    const minimumLevel = Number.isInteger(metadata.minimumLevel)
      ? Math.max(1, Number(metadata.minimumLevel))
      : 1;
    return {
      itemKey: definition.key,
      name: definition.name,
      description: definition.description,
      rarity,
      icon: typeof metadata.icon === 'string' && metadata.icon ? metadata.icon : '?',
      quantity,
      stackLimit: definition.stackLimit,
      equipmentSlot: metadata.equipmentSlot,
      requiredClass: metadata.requiredClass,
      minimumLevel,
      statBonuses: metadata.statBonuses ?? {},
      effect: metadata.effect,
    };
  }
}
