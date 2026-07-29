import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CharacterClass } from '../../common/domain/game.types.js';
import { SKILL_CATALOG, skillsForClass } from './skill.catalog.js';
import { calculateSkillPoints, getSkillEligibility } from './skill.rules.js';
import type { SkillTreeSnapshot } from './skill.types.js';

@Injectable()
export class SkillService {
  constructor(private readonly prisma: PrismaService) {}

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
      await transaction.$queryRaw`
        SELECT "id"
        FROM "Character"
        WHERE "id" = ${characterId}::uuid
        FOR UPDATE
      `;

      const character = await transaction.character.findFirst({
        where: { id: characterId, userId },
        select: {
          class: true,
          level: true,
          skills: {
            select: {
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
      const skill = SKILL_CATALOG.find(
        (candidate) => candidate.key === skillKey && candidate.characterClass === characterClass,
      );
      if (!skill) {
        throw new GameError(GAME_ERROR_CODES.SKILL_NOT_AVAILABLE, 'errors.skills.notAvailable');
      }

      const unlockedKeys = new Set(character.skills.map((entry) => entry.skillDefinition.key));
      if (unlockedKeys.has(skill.key)) return;

      const points = calculateSkillPoints(character.level, character.skills.length);
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

  private buildSnapshot(
    characterClass: CharacterClass,
    characterLevel: number,
    unlocked: ReadonlyArray<{ key: string; rank: number; cooldownTurnsRemaining: number }>,
  ): SkillTreeSnapshot {
    const unlockedByKey = new Map(unlocked.map((skill) => [skill.key, skill]));
    const unlockedKeys = new Set(unlockedByKey.keys());
    const points = calculateSkillPoints(characterLevel, unlocked.length);

    return {
      characterClass,
      characterLevel,
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
}
