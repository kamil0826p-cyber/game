import type {
  CharacterClass,
  CharacterGender,
  CharacterStats,
  CombatState,
  CurrencyBalance,
  Direction,
  PersistedCharacterState,
  ViewportBounds,
} from '../../common/domain/game.types.js';
import type { SupportedLocale } from '../../i18n/localization.service.js';

export interface PlayerSession extends CharacterStats, CurrencyBalance {
  socketId: string;
  connectionId: string;
  characterId: string;
  userId: string;
  realmId: string;
  name: string;
  characterClass: CharacterClass;
  gender: CharacterGender;
  level: number;
  experience: number;
  outfitKey: string;
  mapId: string;
  x: number;
  y: number;
  direction: Direction;
  combatState: CombatState;
  locale: SupportedLocale;
  viewport: ViewportBounds;
  connectedAt: number;
  nextMoveAllowedAt: number;
  stateRevision: number;
  persistedRevision: number;
  dirty: boolean;
  activeInWorld: boolean;
  visibleCharacterIds: Set<string>;
  watcherCharacterIds: Set<string>;
}

export interface CreatePlayerSessionInput {
  socketId: string;
  connectionId: string;
  locale: SupportedLocale;
  character: PersistedCharacterState;
  mapId: string;
  x: number;
  y: number;
  activeInWorld?: boolean;
}
