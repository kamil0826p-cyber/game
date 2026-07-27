import { Injectable } from '@nestjs/common';
import type { AuthContext } from '../../auth/auth-context.interface.js';
import type {
  CharacterClass,
  PersistedCharacterState,
} from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { RealmService } from '../realm/realm.service.js';
import { getDefaultOutfit } from './outfit.catalog.js';
import type {
  CreateCharacterInput,
  FirebaseUserRecord,
  StartingCharacterTemplate,
} from './character.types.js';

const FIRST_USER_BOOTSTRAP_LOCK = 927_401_003;
const FIRST_USER_SILVER = 100_000;
const FIRST_USER_GOLD = 1_000;

const STARTING_TEMPLATES: Readonly<Record<CharacterClass, StartingCharacterTemplate>> = {
  MAGE: { hp: 75, maxHp: 75, energy: 120, maxEnergy: 120, strength: 4, agility: 7, intelligence: 14, armor: 2 },
  WARRIOR: { hp: 130, maxHp: 130, energy: 70, maxEnergy: 70, strength: 14, agility: 7, intelligence: 3, armor: 8 },
  ARCHER: { hp: 95, maxHp: 95, energy: 95, maxEnergy: 95, strength: 7, agility: 14, intelligence: 5, armor: 4 },
};

@Injectable()
export class CharacterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realmService: RealmService,
  ) {}

  async synchronizeFirebaseUser(auth: AuthContext): Promise<FirebaseUserRecord> {
    const user = await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${FIRST_USER_BOOTSTRAP_LOCK})`);
      const synchronized = await transaction.user.upsert({
        where: { firebaseUid: auth.firebaseUid },
        create: { firebaseUid: auth.firebaseUid, email: auth.email, displayName: auth.displayName },
        update: { email: auth.email, displayName: auth.displayName },
        select: { id: true, firebaseUid: true, email: true, displayName: true, role: true },
      });
      const firstUser = await transaction.user.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (firstUser?.id !== synchronized.id || synchronized.role === 'ADMIN') return synchronized;
      return transaction.user.update({
        where: { id: synchronized.id },
        data: { role: 'ADMIN' },
        select: { id: true, firebaseUid: true, email: true, displayName: true, role: true },
      });
    });
    return {
      id: user.id,
      firebaseUid: user.firebaseUid,
      email: user.email ?? undefined,
      displayName: user.displayName ?? undefined,
      role: user.role,
    };
  }

  async findCharacterForCurrentRealm(userId: string): Promise<PersistedCharacterState | undefined> {
    const realm = await this.realmService.getCurrentRealm();
    let character = await this.prisma.character.findUnique({
      where: { userId_realmId: { userId, realmId: realm.id } },
    });
    if (!character) return undefined;
    await this.applyFirstUserBootstrap(userId, character.id);
    character = await this.prisma.character.findUnique({
      where: { userId_realmId: { userId, realmId: realm.id } },
    });
    return character ? this.toPersistedState(character) : undefined;
  }

  async createCharacter(userId: string, input: CreateCharacterInput): Promise<PersistedCharacterState> {
    const realm = await this.realmService.getCurrentRealm();
    const template = STARTING_TEMPLATES[input.characterClass];
    const outfit = getDefaultOutfit(input.characterClass);

    try {
      const character = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.character.findUnique({
          where: { userId_realmId: { userId, realmId: realm.id } },
          select: { id: true },
        });
        if (existing) {
          throw new GameError(GAME_ERROR_CODES.CHARACTER_ALREADY_EXISTS, 'errors.character.exists');
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
            level: 1,
            experience: 0,
            outfitKey: outfit.key,
            mapId: map.id,
            x: map.spawnX,
            y: map.spawnY,
            direction: 'SOUTH',
            combatState: 'IDLE',
            hp: template.hp,
            maxHp: template.maxHp,
            energy: template.energy,
            maxEnergy: template.maxEnergy,
            strength: template.strength,
            agility: template.agility,
            intelligence: template.intelligence,
            armor: template.armor,
            silver: 0,
            gold: 0,
          },
        });
      });
      await this.applyFirstUserBootstrap(userId, character.id);
      const refreshed = await this.prisma.character.findUniqueOrThrow({ where: { id: character.id } });
      return this.toPersistedState(refreshed);
    } catch (error) {
      if (error instanceof GameError) throw error;
      if (this.isUniqueConstraintError(error)) {
        const existing = await this.prisma.character.findUnique({
          where: { userId_realmId: { userId, realmId: realm.id } },
          select: { id: true },
        });
        if (existing) {
          throw new GameError(GAME_ERROR_CODES.CHARACTER_ALREADY_EXISTS, 'errors.character.exists');
        }
        throw new GameError(GAME_ERROR_CODES.CHARACTER_NAME_TAKEN, 'errors.character.nameTaken');
      }
      throw error;
    }
  }

  private async applyFirstUserBootstrap(userId: string, characterId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      await transaction.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${FIRST_USER_BOOTSTRAP_LOCK})`);
      const user = await transaction.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true, firstUserBootstrapAt: true },
      });
      if (!user || user.role !== 'ADMIN' || user.firstUserBootstrapAt) return;
      const firstUser = await transaction.user.findFirst({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      if (firstUser?.id !== user.id) return;
      const character = await transaction.character.findFirst({
        where: { id: characterId, userId },
        select: { id: true, silver: true, gold: true },
      });
      if (!character) return;

      const silverAfter = character.silver + FIRST_USER_SILVER;
      const goldAfter = character.gold + FIRST_USER_GOLD;
      await transaction.character.update({
        where: { id: character.id },
        data: {
          silver: { increment: FIRST_USER_SILVER },
          gold: { increment: FIRST_USER_GOLD },
          stateVersion: { increment: 1 },
          lastSavedAt: new Date(),
        },
      });
      await transaction.characterCurrencyLedger.createMany({
        data: [
          {
            characterId: character.id,
            operationId: 'temporary-first-user-bootstrap-silver',
            currency: 'SILVER',
            direction: 'CREDIT',
            amount: FIRST_USER_SILVER,
            reason: 'TEMPORARY_FIRST_USER_BOOTSTRAP',
            balanceAfter: silverAfter,
            metadata: { temporary: true, userRole: 'ADMIN' },
          },
          {
            characterId: character.id,
            operationId: 'temporary-first-user-bootstrap-gold',
            currency: 'GOLD',
            direction: 'CREDIT',
            amount: FIRST_USER_GOLD,
            reason: 'TEMPORARY_FIRST_USER_BOOTSTRAP',
            balanceAfter: goldAfter,
            metadata: { temporary: true, userRole: 'ADMIN' },
          },
        ],
      });
      await transaction.user.update({
        where: { id: user.id },
        data: { firstUserBootstrapAt: new Date() },
      });
    });
  }

  private toPersistedState(character: {
    id: string;
    userId: string;
    realmId: string;
    name: string;
    class: string;
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
  }): PersistedCharacterState {
    return {
      id: character.id,
      userId: character.userId,
      realmId: character.realmId,
      name: character.name,
      characterClass: character.class as PersistedCharacterState['characterClass'],
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
    return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'P2002';
  }
}
