import type { CharacterClass, CharacterStats } from '../../common/domain/game.types.js';

export interface FirebaseUserRecord {
  id: string;
  firebaseUid: string;
  email?: string;
  displayName?: string;
}

export interface CreateCharacterInput {
  name: string;
  characterClass: CharacterClass;
}

export type StartingCharacterTemplate = CharacterStats;
