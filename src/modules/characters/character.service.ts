import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/auth-context.interface.js';
import type { PersistedCharacterState } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RealmService } from '../realm/realm.service.js';
import { getOutfitForLevel } from './outfit.catalog.js';
import { PROGRESSION_RULES_VERSION } from './progression/character-progression.rules.js';
import { CharacterProgressionService } from './progression/character-progression.service.js';
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
    private readonly progression: CharacterProgressionService,
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
    for (const character of characters) {
      Object.assign(character, await this.progression.ensureCanonical(character.id));
    }
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
    if (!character) return undefined;
    Object.assign(character, await this.progression.ensureCanonical(character.id));
    return this.toPersistedState(character);
  }

  async createCharacter(userId: string, input: CreateCharacterInput): Promise<PersistedCharacterState> {
    const realm = await this.realmService.getCurrentRealm();
    const stats = this.progression.initialStats(input.characterClass);
    const outfitKey = getOutfitForLevel(input.characterClass, 1).key;

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
            progressionVersion: PROGRESSION_RULES_VERSION,
            progressionData: this.progression.initialProgressionData(),
            freeRespecAvailable: true,
            progressionMigratedAt: new Date(),
          },
        });
      });
      return this.toPersistedState(character);
    } catch (error) {
      if (error instanceof GameError) throw error;
      if (this.isUniqueConstraintError(error)) {
        throw new GameError(GAME_ERROR_CODES.CHARACTER_NAME_TAKEN, 'errors.character.nameTaken');
      }
      throw error;
    }
  }

  private toPersistedState(character: CharacterRow): PersistedCharacterState {
    const characterClass = character.class as PersistedCharacterState['characterClass'];
    return {
      id: character.id,
      userId: character.userId,
      realmId: character.realmId,
      name: character.name,
      characterClass,
      gender: (character.gender ?? 'MALE') as PersistedCharacterState['gender'],
      level: character.level,
      experience: character.experience,
      outfitKey: getOutfitForLevel(characterClass, character.level).key,
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
