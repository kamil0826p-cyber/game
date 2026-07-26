export const CHARACTER_CLASSES = ['MAGE', 'WARRIOR', 'ARCHER'] as const;
export type CharacterClass = (typeof CHARACTER_CLASSES)[number];

export const DIRECTIONS = ['NORTH', 'EAST', 'SOUTH', 'WEST'] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const ZONE_TYPES = ['SAFE', 'OUTLAW', 'PVP'] as const;
export type ZoneType = (typeof ZONE_TYPES)[number];

export const COMBAT_STATES = ['IDLE', 'IN_BATTLE'] as const;
export type CombatState = (typeof COMBAT_STATES)[number];

export interface Coordinates {
  x: number;
  y: number;
}

export interface ViewportBounds {
  halfWidth: number;
  halfHeight: number;
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

export interface PersistedCharacterState extends CharacterStats {
  id: string;
  userId: string;
  realmId: string;
  name: string;
  characterClass: CharacterClass;
  level: number;
  experience: number;
  outfitKey: string;
  mapId: string;
  x: number;
  y: number;
  direction: Direction;
  combatState: CombatState;
  stateVersion: number;
  lastSavedAt: Date;
}

export const DIRECTION_DELTAS: Readonly<Record<Direction, Coordinates>> = {
  NORTH: { x: 0, y: -1 },
  EAST: { x: 1, y: 0 },
  SOUTH: { x: 0, y: 1 },
  WEST: { x: -1, y: 0 },
};
