export const CHARACTER_CLASSES = ['MAGE', 'WARRIOR', 'ARCHER'] as const;
export type CharacterClass = (typeof CHARACTER_CLASSES)[number];

export const DIRECTIONS = ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export type ZoneType = 'SAFE' | 'OUTLAW' | 'PVP';
export type CombatState = 'IDLE' | 'IN_BATTLE';

export interface Coordinates {
  x: number;
  y: number;
}

export interface CharacterStats {
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
}

export interface CurrencyBalance {
  silver?: number;
  gold?: number;
}

export interface PublicPlayerState {
  characterId: string;
  name: string;
  characterClass: CharacterClass;
  level: number;
  outfitKey: string;
  mapId: string;
  x: number;
  y: number;
  direction: Direction;
  combatState: CombatState;
}

export interface SelfCharacterState extends PublicPlayerState, CharacterStats, CurrencyBalance {
  experience: number;
}

export interface MapStatePayload {
  id: string;
  key: string;
  name: string;
  width: number;
  height: number;
  zoneType: ZoneType;
  version: number;
}

export interface RealmState {
  id: string;
  slug: string;
  name: string;
}

export const DIRECTION_DELTAS: Readonly<Record<Direction, Coordinates>> = {
  NORTH: { x: 0, y: -1 },
  EAST: { x: 1, y: 0 },
  SOUTH: { x: 0, y: 1 },
  WEST: { x: -1, y: 0 },
};