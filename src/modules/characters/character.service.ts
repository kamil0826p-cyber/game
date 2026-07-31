import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/auth-context.interface.js';
import type { PersistedCharacterState } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { TelemetryService } from '../../telemetry/telemetry.service.js';
import { RealmService } from '../realm/realm.service.js';
import { getDefaultOutfit, isOutfitUnlocked } from './outfit.catalog.js';
import { ProgressionService } from './progression.service.js';
import type { CreateCharacterInput, FirebaseUserRecord } from './character.types.js';

export const MAX_CHARACTERS_PER_REALM = 5;

interface CharacterRow {
  id: string;
  userId: string;
  realmId: string;
  name: string;
  class: string;
  gender?: string;
  level: number;
  experience: number;
  outfitKey: string;
  mapId: string;
  x: number;
  y: number;
  direction: string;
  combatState: string;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
  silver: number;
  gold: number;
  stateVersion: number;
  lastSavedAt: Date;
}

@Injectable()
export class CharacterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realmService: RealmService,
    private readonly progression: ProgressionService,
    private readonly telemetry: TelemetryService,
  ) {}

  async synchronizeFirebaseUser(auth: AuthContext): Promise<FirebaseUserRecord> {
    const user = await this.prisma.user.upsert({
      where: { firebaseUid: auth.firebaseUid },
      create: { firebaseUid: auth.firebaseUid, email: auth.email, displayName: auth.displayName },
      update: { email: auth.email, displayName: auth.displayName },
      select: { id: true, firebaseUid: true, email: true, displayName: true, role: true },
    });
    return {
      id: user.id,
      firebaseUid: user.firebaseUid,
      email: user.email ?? undefined,
      displayName: user.displayName ?? undefined,
      role: user.role,
    };
  }

  async listCharactersForCurrentRealm(userId: string): Promise<PersistedCharacterState[]> {
    const realm = await this.realmService.getCurrentRealm();
    const characters = await this.prisma.character.findMany({
      where: { userId, realmId: realm.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return characters.map((character) => this.toPersistedState(character));
  }

  async findCharacterForCurrentRealm(
    userId: string,
    characterId?: string,
  ): Promise<PersistedCharacterState | undefined> {
    const realm = await this.realmService.getCurrentRealm();
    const character = await this.prisma.character.findFirst({
      where: {
        userId,
        realmId: realm.id,
        ...(characterId ? { id: characterId } : {}),
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return character ? this.toPersistedState(character) : undefined;
  }

  async createCharacter(userId: string, input: CreateCharacterInput): Promise<PersistedCharacterState> {
    const realm = await this.realmService.getCurrentRealm();
    const stats = this.progression.calculateBaseStats(input.characterClass, 1);
    const defaultOutfit = getDefaultOutfit(input.characterClass).key;
    const requestedOutfit = input.outfitKey ?? defaultOutfit;
    const outfitKey = isOutfitUnlocked(input.characterClass, 1, requestedOutfit)
      ? requestedOutfit
      : defaultOutfit;

    try {
      const character = await this.prisma.$transaction(async (transaction) => {
        const lockKey = `${userId}:${realm.id}`;
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        const count = await transaction.character.count({
          where: { userId, realmId: realm.id },
        });
        if (count >= MAX_CHARACTERS_PER_REALM) {
          throw new GameError(
            GAME_ERROR_CODES.CHARACTER_LIMIT_REACHED,
            'errors.character.limitReached',
            { maxCharacters: MAX_CHARACTERS_PER_REALM },
          );
        }

        const map = await transaction.map.findFirst({
          where: { id: realm.defaultMapId, realmId: realm.id },
          select: { id: true, spawnX: true, spawnY: true },
        });
        if (!map) {
          throw new GameError(GAME_ERROR_CODES.REALM_UNAVAILABLE, 'errors.realm.unavailable');
        }

        return transaction.character.create({
          data: {
            userId,
            realmId: realm.id,
            name: input.name,
            class: input.characterClass,
            gender: input.gender ?? 'MALE',
            level: 1,
            experience: 0,
            outfitKey,
            mapId: map.id,
            x: map.spawnX,
            y: map.spawnY,
            direction: 'SOUTH',
            combatState: 'IDLE',
            hp: stats.maxHp,
            maxHp: stats.maxHp,
            energy: stats.maxEnergy,
            maxEnergy: stats.maxEnergy,
            strength: stats.strength,
            agility: stats.agility,
            intelligence: stats.intelligence,
            armor: stats.armor,
            silver: 0,
            gold: 0,
          },
        });
      });
      this.telemetry.emit(
        'character_created',
        { userId, characterId: character.id, realmId: character.realmId },
        { characterClass: input.characterClass },
      );
      return this.toPersistedState(character);
    } catch (error) {
      if (error instanceof GameError) throw error;
      if (this.isUniqueConstraintError(error)) {
        throw new GameError(GAME_ERROR_CODES.CHARACTER_NAME_TAKEN, 'errors.character.nameTaken');
      }
      throw error;
    }
  }

  async migrateCharacterProgression(
    userId: string,
    characterId: string,
  ): Promise<PersistedCharacterState> {
    const updated = await this.prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id"
        FROM "Character"
        WHERE "id" = ${characterId}::uuid
        FOR UPDATE
      `;
      const character = await transaction.character.findFirst({
        where: { id: characterId, userId },
      });
      if (!character) {
        throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.character.required');
      }

      const level = this.progression.clampLevel(character.level);
      const stats = this.progression.calculateBaseStats(character.class, level);
      const hpRatio = character.maxHp > 0 ? character.hp / character.maxHp : 1;
      const energyRatio = character.maxEnergy > 0 ? character.energy / character.maxEnergy : 1;
      return transaction.character.update({
        where: { id: character.id },
        data: {
          level,
          experience: level >= this.progression.maximumLevel ? 0 : Math.max(0, character.experience),
          maxHp: stats.maxHp,
          hp: Math.max(0, Math.min(stats.maxHp, Math.round(stats.maxHp * hpRatio))),
          maxEnergy: stats.maxEnergy,
          energy: Math.max(0, Math.min(stats.maxEnergy, Math.round(stats.maxEnergy * energyRatio))),
          strength: stats.strength,
          agility: stats.agility,
          intelligence: stats.intelligence,
          armor: stats.armor,
          stateVersion: { increment: 1 },
          lastSavedAt: new Date(),
        },
      });
    });
    return this.toPersistedState(updated);
  }

  async updateOutfit(
    userId: string,
    characterId: string,
    outfitKey: string,
  ): Promise<PersistedCharacterState> {
    const character = await this.findCharacterForCurrentRealm(userId, characterId);
    if (!character) {
      throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.character.required');
    }
    if (!isOutfitUnlocked(character.characterClass, character.level, outfitKey)) {
      throw new GameError(GAME_ERROR_CODES.OUTFIT_NOT_UNLOCKED, 'errors.character.outfitLocked');
    }

    const updated = await this.prisma.character.update({
      where: { id: character.id },
      data: {
        outfitKey,
        stateVersion: { increment: 1 },
        lastSavedAt: new Date(),
      },
    });
    return this.toPersistedState(updated);
  }

  private toPersistedState(character: CharacterRow): PersistedCharacterState {
    return {
      id: character.id,
      userId: character.userId,
      realmId: character.realmId,
      name: character.name,
      characterClass: character.class as PersistedCharacterState['characterClass'],
      gender: (character.gender ?? 'MALE') as PersistedCharacterState['gender'],
      level: character.level,
      experience: character.experience,
      outfitKey: character.outfitKey,
      mapId: character.mapId,
      x: character.x,
      y: character.y,
      direction: character.direction as PersistedCharacterState['direction'],
      combatState: character.combatState as PersistedCharacterState['combatState'],
      hp: character.hp,
      maxHp: character.maxHp,
      energy: character.energy,
      maxEnergy: character.maxEnergy,
      strength: character.strength,
      agility: character.agility,
      intelligence: character.intelligence,
      armor: character.armor,
      silver: character.silver,
      gold: character.gold,
      stateVersion: character.stateVersion,
      lastSavedAt: character.lastSavedAt,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}
