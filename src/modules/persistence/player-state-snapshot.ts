import type { CombatState, Direction } from '../../common/domain/game.types.js';
import { getOutfitForLevel } from '../characters/outfit.catalog.js';
import type { PlayerSession } from '../world/player-session.types.js';

export interface PlayerStateSnapshot {
  characterId: string;
  connectionId: string;
  realmId: string;
  mapId: string;
  x: number;
  y: number;
  direction: Direction;
  level: number;
  experience: number;
  outfitKey: string;
  combatState: CombatState;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
  revision: number;
  capturedAt: number;
}

export const capturePlayerState = (session: PlayerSession): PlayerStateSnapshot => ({
  characterId: session.characterId,
  connectionId: session.connectionId,
  realmId: session.realmId,
  mapId: session.mapId,
  x: session.x,
  y: session.y,
  direction: session.direction,
  level: session.level,
  experience: session.experience,
  outfitKey: getOutfitForLevel(session.characterClass, session.level).key,
  combatState: session.combatState,
  hp: session.hp,
  maxHp: session.maxHp,
  energy: session.energy,
  maxEnergy: session.maxEnergy,
  strength: session.strength,
  agility: session.agility,
  intelligence: session.intelligence,
  armor: session.armor,
  revision: session.stateRevision,
  capturedAt: Date.now(),
});
