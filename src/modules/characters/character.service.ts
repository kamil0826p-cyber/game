import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/auth-context.interface.js';
import type { CharacterClass, PersistedCharacterState } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RealmService } from '../realm/realm.service.js';
import { getDefaultOutfit, isOutfitUnlocked } from './outfit.catalog.js';
import type { CreateCharacterInput, FirebaseUserRecord, StartingCharacterTemplate } from './character.types.js';

export const MAX_CHARACTERS_PER_REALM = 5;

const STARTING_TEMPLATES: Readonly<Record<CharacterClass, StartingCharacterTemplate>> = {
  MAGE: { hp: 75, maxHp: 75, energy: 120, maxEnergy: 120, strength: 4, agility: 7, intelligence: 14, armor: 2 },
  WARRIOR: { hp: 130, maxHp: 130, energy: 70, maxEnergy: 70, strength: 14, agility: 7, intelligence: 3, armor: 8 },
  ARCHER: { hp: 95, maxHp: 95, energy: 95, maxEnergy: 95, strength: 7, agility: 14, intelligence: 5, armor: 4 },
};

type CharacterRecord = {
  id: string; userId: string; realmId: string; name: string; class: string; level: number; experience: number;
  outfitKey: string; mapId: string; x: number; y: number; direction: string; combatState: string;
  hp: number; maxHp: number; energy: number; maxEnergy: number; strength: number; agility: number;
  intelligence: number; armor: number; silver: number; gold: number; stateVersion: number; lastSavedAt: Date;
};

@Injectable()
export class CharacterService {
  constructor(private readonly prisma: PrismaService, private readonly realmService: RealmService) {}

  async synchronizeFirebaseUser(auth: AuthContext): Promise<FirebaseUserRecord> {
    const user = await this.prisma.user.upsert({
      where: { firebaseUid: auth.firebaseUid },
      create: { firebaseUid: auth.firebaseUid, email: auth.email, displayName: auth.displayName },
      update: { email: auth.email, displayName: auth.displayName },
      select: { id: true, firebaseUid: true, email: true, displayName: true, role: true },
    });
    return { id: user.id, firebaseUid: user.firebaseUid, email: user.email ?? undefined, displayName: user.displayName ?? undefined, role: user.role };
  }

  async listCharactersForCurrentRealm(userId: string): Promise<PersistedCharacterState[]> {
    const realm = await this.realmService.getCurrentRealm();
    const characters = await this.prisma.character.findMany({
      where: { userId, realmId: realm.id },
      orderBy: [{ lastSavedAt: 'desc' }, { createdAt: 'asc' }],
    });
    return characters.map((character) => this.toPersistedState(character));
  }

  async findCharacterForCurrentRealm(userId: string): Promise<PersistedCharacterState | undefined> {
    return (await this.listCharactersForCurrentRealm(userId))[0];
  }

  async findOwnedCharacter(userId: string, characterId: string): Promise<PersistedCharacterState> {
    const realm = await this.realmService.getCurrentRealm();
    const character = await this.prisma.character.findFirst({ where: { id: characterId, userId, realmId: realm.id } });
    if (!character) throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.character.notFound');
    return this.toPersistedState(character);
  }

  async changeOutfit(userId: string, characterId: string, outfitKey: string): Promise<PersistedCharacterState> {
    const character = await this.findOwnedCharacter(userId, characterId);
    if (!isOutfitUnlocked(character.characterClass, character.level, outfitKey)) {
      throw new GameError(GAME_ERROR_CODES.CHARACTER_OUTFIT_LOCKED, 'errors.character.outfitLocked');
    }
    const updated = await this.prisma.character.update({
      where: { id: character.id },
      data: { outfitKey, stateVersion: { increment: 1 }, lastSavedAt: new Date() },
    });
    return this.toPersistedState(updated);
  }

  async createCharacter(userId: string, input: CreateCharacterInput): Promise<PersistedCharacterState> {
    const realm = await this.realmService.getCurrentRealm();
    const template = STARTING_TEMPLATES[input.characterClass];
    const outfit = getDefaultOutfit(input.characterClass);
    try {
      const character = await this.prisma.$transaction(async (transaction) => {
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${realm.id}`}))`;
        const count = await transaction.character.count({ where: { userId, realmId: realm.id } });
        if (count >= MAX_CHARACTERS_PER_REALM) {
          throw new GameError(GAME_ERROR_CODES.CHARACTER_LIMIT_REACHED, 'errors.character.limitReached', { limit: MAX_CHARACTERS_PER_REALM });
        }
        const nameTaken = await transaction.character.findFirst({
          where: { realmId: realm.id, name: input.name },
          select: { id: true },
        });
        if (nameTaken) {
          throw new GameError(GAME_ERROR_CODES.CHARACTER_NAME_TAKEN, 'errors.character.nameTaken');
        }
        const map = await transaction.map.findFirst({
          where: { id: realm.defaultMapId, realmId: realm.id },
          select: { id: true, spawnX: true, spawnY: true },
        });
        if (!map) throw new GameError(GAME_ERROR_CODES.REALM_UNAVAILABLE, 'errors.realm.unavailable');
        return transaction.character.create({
          data: {
            userId, realmId: realm.id, name: input.name, class: input.characterClass, level: 1, experience: 0,
            outfitKey: outfit.key, mapId: map.id, x: map.spawnX, y: map.spawnY, direction: 'SOUTH', combatState: 'IDLE',
            hp: template.hp, maxHp: template.maxHp, energy: template.energy, maxEnergy: template.maxEnergy,
            strength: template.strength, agility: template.agility, intelligence: template.intelligence, armor: template.armor,
            silver: 0, gold: 0,
          },
        });
      });
      return this.toPersistedState(character);
    } catch (error) {
      if (error instanceof GameError) throw error;
      if (this.isCharacterNameConstraintError(error)) {
        throw new GameError(GAME_ERROR_CODES.CHARACTER_NAME_TAKEN, 'errors.character.nameTaken');
      }
      throw error;
    }
  }

  private toPersistedState(character: CharacterRecord): PersistedCharacterState {
    return {
      id: character.id, userId: character.userId, realmId: character.realmId, name: character.name,
      characterClass: character.class as PersistedCharacterState['characterClass'], level: character.level,
      experience: character.experience, outfitKey: character.outfitKey, mapId: character.mapId, x: character.x, y: character.y,
      direction: character.direction as PersistedCharacterState['direction'],
      combatState: character.combatState as PersistedCharacterState['combatState'], hp: character.hp, maxHp: character.maxHp,
      energy: character.energy, maxEnergy: character.maxEnergy, strength: character.strength, agility: character.agility,
      intelligence: character.intelligence, armor: character.armor, silver: character.silver, gold: character.gold,
      stateVersion: character.stateVersion, lastSavedAt: character.lastSavedAt,
    };
  }

  private isCharacterNameConstraintError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null || !('code' in error)) return false;
    const prismaError = error as { code?: unknown; meta?: { target?: unknown } };
    if (prismaError.code !== 'P2002') return false;
    const target = prismaError.meta?.target;
    if (Array.isArray(target)) return target.includes('name');
    return typeof target === 'string' && target.toLowerCase().includes('name');
  }
}
