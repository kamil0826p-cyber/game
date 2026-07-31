import { Injectable, Optional } from '@nestjs/common';
import type { CharacterClass, EquipmentSlot } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { stampContentSnapshot } from '../../content/content-instance-version.js';
import { CURRENT_CONTENT_VERSION } from '../../content/current-content.js';
import type { ItemRarity, ItemStatBonuses } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import { DomainEventService } from '../../domain-events/domain-event.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { INVENTORY_CAPACITY } from '../items/item.service.js';
import { QuestService } from '../quests/quest.service.js';
import { skillPointsGainedBetweenLevels } from '../skills/skill.rules.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { applyExperience, statGrowthForLevels } from './character-progression.js';
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
    private readonly domainEvents: DomainEventService,
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
      const experienceAward = canReceiveMobExperience(character.level, mob.level) ? mob.experience : 0;
      const progression = applyExperience(character.level, character.experience, experienceAward);
      const skillPointsGained = skillPointsGainedBetweenLevels(character.level, progression.level);
      const growth = statGrowthForLevels(progression.levelsGained);
      const maxHp = character.maxHp + growth.maxHp;
      const maxEnergy = character.maxEnergy + growth.maxEnergy;
      const updated = await transaction.character.update({
        where: { id: character.id },
        data: {
          level: progression.level,
          experience: progression.experience,
          hp: Math.min(maxHp, character.hp + growth.maxHp),
          maxHp,
          energy: Math.min(maxEnergy, character.energy + growth.maxEnergy),
          maxEnergy,
          strength: character.strength + growth.strength,
          agility: character.agility + growth.agility,
          intelligence: character.intelligence + growth.intelligence,
          armor: character.armor + growth.armor,
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
      const operationId = `mob-defeat:${mob.id}:${character.id}:${updated.stateVersion}`;
      await this.domainEvents.append(transaction, {
        operationId,
        type: 'MobDefeated',
        actorCharacterId: character.id,
        realmId: session.realmId,
        mapId: mob.mapId,
        payload: {
          combatId: operationId,
          mobId: mob.id,
          mobDefinitionKey: mob.definitionKey,
          characterId: character.id,
          mobLevel: mob.level,
          audit: [
            ...(experienceAward > 0 ? [{
              characterId: character.id,
              resourceType: 'XP' as const,
              amount: experienceAward,
              balanceAfter: updated.experience,
              reason: 'MOB_DEFEATED',
              metadata: { mobId: mob.id, mobDefinitionKey: mob.definitionKey },
            }] : []),
            ...loot.granted.map((item) => ({
              characterId: character.id,
              resourceType: 'ITEM' as const,
              resourceKey: item.itemKey,
              amount: item.quantity,
              reason: 'MOB_LOOT',
              metadata: { mobId: mob.id, mobDefinitionKey: mob.definitionKey },
            })),
          ],
          contributions: [{
            subjectType: 'CHARACTER' as const,
            subjectId: character.id,
            kind: 'MOB_DEFEAT',
            amount: 1,
            metadata: { eligible: true, actions: 1, mobDefinitionKey: mob.definitionKey },
          }],
        },
      });
      for (const item of loot.granted) {
        await this.domainEvents.append(transaction, {
          operationId: `${operationId}:item:${item.itemKey}`,
          type: 'ItemAcquired',
          actorCharacterId: character.id,
          realmId: session.realmId,
          mapId: mob.mapId,
          payload: {
            characterId: character.id,
            itemKey: item.itemKey,
            quantity: item.quantity,
            source: 'MOB_LOOT',
            sourceOperationId: operationId,
            mobId: mob.id,
          },
        });
      }
      return { progression, skillPointsGained, updated, experienceAward, ...loot };
    });
    Object.assign(session, result.updated);
    session.stateRevision = Math.max(session.stateRevision + 1, result.updated.stateVersion);
    session.persistedRevision = Math.max(session.persistedRevision, result.updated.stateVersion);
    session.dirty = false;
    await this.quests?.recordMobKill(session.characterId, mob.definitionKey).catch(() => undefined);
    return {
      experienceGained: result.experienceAward,
      levelsGained: result.progression.levelsGained,
      skillPointsGained: result.skillPointsGained,
      nextLevelExperience: result.progression.nextLevelExperience,
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
    }) as Array<{ id: string; key: string; name: string; description: string; stackLimit: number; metadata: Prisma.JsonValue }>;
    const definitionsByKey = new Map<string, (typeof definitions)[number]>(definitions.map((definition) => [definition.key, definition]));
    const items = await transaction.inventoryItem.findMany({
      where: { characterId },
      orderBy: { slotIndex: 'asc' },
    });
    const occupied = new Set((items as Array<{ slotIndex: number }>).map((item: { slotIndex: number }) => item.slotIndex));
    const granted: SettledLoot[] = [];
    const skipped: SettledLoot[] = [];
    for (const reward of rewards) {
      const definition = definitionsByKey.get(reward.itemKey);
      if (!definition) continue;
      const instanceData = stampContentSnapshot({}, {
        instanceType: 'ITEM',
        contentVersion: CURRENT_CONTENT_VERSION,
        definitionKey: definition.key,
        definition: {
          key: definition.key,
          name: definition.name,
          description: definition.description,
          stackLimit: definition.stackLimit,
          metadata: definition.metadata,
        },
      }) as unknown as Prisma.InputJsonValue;
      let remaining = reward.quantity;
      let grantedQuantity = 0;
      const stacks = (items as Array<{ id: string; itemDefinitionId: string; equippedSlot: string | null; quantity: number; slotIndex: number; instanceData: Prisma.JsonValue }>).filter((item) =>
        item.itemDefinitionId === definition.id &&
        item.equippedSlot === null &&
        item.quantity < definition.stackLimit &&
        JSON.stringify(item.instanceData) === JSON.stringify(instanceData));
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
      for (let slotIndex = 0; slotIndex < INVENTORY_CAPACITY && remaining > 0; slotIndex += 1) {
        if (occupied.has(slotIndex)) continue;
        const quantity = Math.min(remaining, definition.stackLimit);
        const created = await transaction.inventoryItem.create({
          data: {
            characterId,
            itemDefinitionId: definition.id,
            quantity,
            slotIndex,
            instanceData,
          },
        });
        items.push(created);
        occupied.add(slotIndex);
        remaining -= quantity;
        grantedQuantity += quantity;
      }
      if (grantedQuantity > 0) granted.push(this.toSettledLoot(definition, grantedQuantity));
      if (remaining > 0) skipped.push(this.toSettledLoot(definition, remaining));
    }
    return { granted, skipped };
  }

  private toSettledLoot(
    definition: { key: string; name: string; description: string; stackLimit: number; metadata: Prisma.JsonValue },
    quantity: number,
  ): SettledLoot {
    const metadata = definition.metadata as unknown as RewardItemMetadata;
    const rarity = ['COMMON', 'ARTIFACT', 'MYTHIC'].includes(String(metadata.rarity))
      ? metadata.rarity as ItemRarity
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
