import { Injectable } from '@nestjs/common';
import type { CharacterClass } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { ProgressionService } from '../characters/progression.service.js';
import { repairSkillBuild } from './skill-build.rules.js';
import { SKILL_CATALOG, skillsForClass } from './skill.catalog.js';
import { getSkillEligibility } from './skill.rules.js';
import type { SkillTreeSnapshot } from './skill.types.js';

@Injectable()
export class SkillService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly progression: ProgressionService,
  ) {}

  async getSnapshot(userId: string, characterId: string): Promise<SkillTreeSnapshot> {
    const character = await this.prisma.character.findFirst({
      where: { id: characterId, userId },
      select: {
        class: true,
        level: true,
        skills: {
          select: {
            rank: true,
            cooldownTurnsRemaining: true,
            skillDefinition: { select: { key: true } },
          },
        },
      },
    });
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }

    return this.buildSnapshot(
      character.class as CharacterClass,
      character.level,
      character.skills.map((skill) => ({
        key: skill.skillDefinition.key,
        rank: skill.rank,
        cooldownTurnsRemaining: skill.cooldownTurnsRemaining,
      })),
    );
  }

  async unlock(userId: string, characterId: string, skillKey: string): Promise<SkillTreeSnapshot> {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const character = await transaction.character.findFirst({
        where: { id: characterId, userId },
        select: {
          class: true,
          level: true,
          skills: {
            select: {
              rank: true,
              skillDefinitionId: true,
              skillDefinition: { select: { key: true } },
            },
          },
        },
      });
      if (!character) {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }

      const characterClass = character.class as CharacterClass;
      const repaired = repairSkillBuild(
        characterClass,
        character.level,
        this.getEarnedPointBudget(characterClass, character.level),
        SKILL_CATALOG,
        character.skills.map((entry) => ({
          key: entry.skillDefinition.key,
          rank: entry.rank,
        })),
      );
      if (repaired.removed.length > 0 || repaired.kept.some((entry) => entry.rank !== entry.originalRank)) {
        await this.applyRepair(
          transaction,
          characterId,
          repaired.removed.map((entry) => entry.key),
          repaired.kept,
        );
      }

      const skill = SKILL_CATALOG.find(
        (candidate) => candidate.key === skillKey && candidate.characterClass === characterClass,
      );
      if (!skill) {
        throw new GameError(GAME_ERROR_CODES.SKILL_NOT_AVAILABLE, 'errors.skills.notAvailable');
      }

      const unlockedKeys = new Set(repaired.kept.map((entry) => entry.key));
      if (unlockedKeys.has(skill.key)) return;

      const points = this.progression.calculateSkillPointBudget(
        character.level,
        repaired.spentPoints,
        this.getPointCapacity(characterClass),
      );
      const eligibility = getSkillEligibility(
        skill,
        character.level,
        unlockedKeys,
        points.available,
      );

      if (eligibility.unlockState === 'LOCKED_LEVEL') {
        throw new GameError(GAME_ERROR_CODES.SKILL_LEVEL_REQUIRED, 'errors.skills.levelRequired', {
          minimumLevel: skill.minimumLevel,
        });
      }
      if (eligibility.unlockState === 'LOCKED_PREREQUISITE') {
        throw new GameError(
          GAME_ERROR_CODES.SKILL_PREREQUISITE_REQUIRED,
          'errors.skills.prerequisiteRequired',
          { missingSkillKeys: eligibility.missingPrerequisiteKeys },
        );
      }
      if (eligibility.unlockState === 'LOCKED_POINTS') {
        throw new GameError(
          GAME_ERROR_CODES.SKILL_POINTS_UNAVAILABLE,
          'errors.skills.pointsUnavailable',
        );
      }

      const persistedDefinition = await transaction.skillDefinition.findUnique({
        where: { key: skill.key },
        select: { id: true, requiredClass: true },
      });
      if (!persistedDefinition || persistedDefinition.requiredClass !== character.class) {
        throw new GameError(GAME_ERROR_CODES.SKILL_NOT_AVAILABLE, 'errors.skills.notAvailable');
      }

      await transaction.characterSkill.create({
        data: {
          characterId,
          skillDefinitionId: persistedDefinition.id,
          rank: 1,
          cooldownTurnsRemaining: 0,
        },
      });
    });

    return this.getSnapshot(userId, characterId);
  }

  async respec(userId: string, characterId: string): Promise<SkillTreeSnapshot> {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const character = await transaction.character.findFirst({
        where: { id: characterId, userId },
        select: { id: true },
      });
      if (!character) {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }
      await transaction.characterSkill.deleteMany({ where: { characterId } });
    });
    return this.getSnapshot(userId, characterId);
  }

  async repairBuild(userId: string, characterId: string): Promise<SkillTreeSnapshot> {
    await this.prisma.$transaction(async (transaction) => {
      await this.lockCharacter(transaction, characterId);
      const character = await transaction.character.findFirst({
        where: { id: characterId, userId },
        select: {
          class: true,
          level: true,
          skills: {
            select: {
              rank: true,
              skillDefinition: { select: { key: true } },
            },
          },
        },
      });
      if (!character) {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }
      const characterClass = character.class as CharacterClass;
      const repaired = repairSkillBuild(
        characterClass,
        character.level,
        this.getEarnedPointBudget(characterClass, character.level),
        SKILL_CATALOG,
        character.skills.map((entry) => ({
          key: entry.skillDefinition.key,
          rank: entry.rank,
        })),
      );
      await this.applyRepair(
        transaction,
        characterId,
        repaired.removed.map((entry) => entry.key),
        repaired.kept,
      );
    });
    return this.getSnapshot(userId, characterId);
  }

  async persistCooldowns(
    characterId: string,
    cooldowns: Readonly<Record<string, number>>,
  ): Promise<void> {
    const entries = Object.entries(cooldowns);
    if (entries.length === 0) return;
    await this.prisma.$transaction(
      entries.map(([key, cooldownTurnsRemaining]) =>
        this.prisma.characterSkill.updateMany({
          where: { characterId, skillDefinition: { key } },
          data: { cooldownTurnsRemaining: Math.max(0, Math.trunc(cooldownTurnsRemaining)) },
        }),
      ),
    );
  }

  private buildSnapshot(
    characterClass: CharacterClass,
    characterLevel: number,
    unlocked: ReadonlyArray<{ key: string; rank: number; cooldownTurnsRemaining: number }>,
  ): SkillTreeSnapshot {
    const unlockedByKey = new Map(unlocked.map((skill) => [skill.key, skill]));
    const unlockedKeys = new Set(unlockedByKey.keys());
    const points = this.progression.calculateSkillPointBudget(
      characterLevel,
      unlocked.reduce((sum, skill) => sum + skill.rank, 0),
      this.getPointCapacity(characterClass),
    );

    return {
      characterClass,
      characterLevel: this.progression.clampLevel(characterLevel),
      points,
      skills: skillsForClass(characterClass).map((skill) => {
        const characterSkill = unlockedByKey.get(skill.key);
        const eligibility = getSkillEligibility(
          skill,
          characterLevel,
          unlockedKeys,
          points.available,
        );
        return {
          key: skill.key,
          name: skill.name,
          description: skill.description,
          characterClass: skill.characterClass,
          minimumLevel: skill.minimumLevel,
          energyCost: skill.energyCost,
          cooldownTurns: skill.cooldownTurns,
          targeting: skill.targeting,
          maxRank: skill.maxRank,
          displayOrder: skill.displayOrder,
          treeRow: skill.treeRow,
          treeColumn: skill.treeColumn,
          icon: skill.icon,
          prerequisiteKeys: [...skill.prerequisiteKeys],
          effects: [...skill.effects],
          animationKey: skill.animationKey,
          visual: { ...skill.visual },
          rank: characterSkill?.rank ?? 0,
          cooldownTurnsRemaining: characterSkill?.cooldownTurnsRemaining ?? 0,
          unlockState: eligibility.unlockState,
          missingPrerequisiteKeys: eligibility.missingPrerequisiteKeys,
        };
      }),
    };
  }

  private async lockCharacter(
    transaction: Prisma.TransactionClient,
    characterId: string,
  ): Promise<void> {
    await transaction.$queryRaw`
      SELECT "id"
      FROM "Character"
      WHERE "id" = ${characterId}::uuid
      FOR UPDATE
    `;
  }

  private async applyRepair(
    transaction: Prisma.TransactionClient,
    characterId: string,
    removedKeys: readonly string[],
    kept: readonly { key: string; rank: number; originalRank: number }[],
  ): Promise<void> {
    if (removedKeys.length > 0) {
      await transaction.characterSkill.deleteMany({
        where: {
          characterId,
          skillDefinition: { key: { in: [...removedKeys] } },
        },
      });
    }
    for (const entry of kept) {
      if (entry.rank === entry.originalRank) continue;
      await transaction.characterSkill.updateMany({
        where: { characterId, skillDefinition: { key: entry.key } },
        data: { rank: entry.rank, cooldownTurnsRemaining: 0 },
      });
    }
  }

  private getEarnedPointBudget(characterClass: CharacterClass, level: number): number {
    return this.progression.calculateSkillPointBudget(
      level,
      0,
      this.getPointCapacity(characterClass),
    ).earned;
  }

  private getPointCapacity(characterClass: CharacterClass): number {
    return skillsForClass(characterClass).reduce((sum, skill) => sum + skill.maxRank, 0);
  }
}
