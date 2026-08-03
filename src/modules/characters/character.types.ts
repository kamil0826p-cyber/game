import type {
  CharacterClass,
  CharacterGender,
  CharacterStats,
} from '../../common/domain/game.types.js';

export type UserRole = 'USER' | 'MOD' | 'ADMIN';

export interface FirebaseUserRecord {
  id: string;
  firebaseUid: string;
  email?: string;
  displayName?: string;
  role: UserRole;
}

export interface CreateCharacterInput {
  name: string;
  characterClass: CharacterClass;
  gender?: CharacterGender;
}

export type StartingCharacterTemplate = CharacterStats;
