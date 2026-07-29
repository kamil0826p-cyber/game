import type { CharacterClass } from '../../common/domain/game.types.js';
import type { CombatActorInput } from '../combat/combat.types.js';
import type { MobLootEntry, MobRank } from './mob.catalog.js';

export type MobRuntimeState = 'ALIVE' | 'IN_COMBAT' | 'RESPAWNING';

export interface RuntimeMob {
  id: string;
  definitionKey: string;
  name: string;
  rank: MobRank;
  mapId: string;
  x: number;
  y: number;
  level: number;
  characterClass: CharacterClass;
  outfitKey: string;
  renderScale: number;
  respawnMs: number;
  experience: number;
  stats: {
    maxHp: number;
    maxEnergy: number;
    strength: number;
    agility: number;
    intelligence: number;
    armor: number;
  };
  loot: readonly MobLootEntry[];
  state: MobRuntimeState;
  engagedCharacterId?: string;
  respawnsAt?: number;
}

export interface ClaimedMob {
  mob: RuntimeMob;
  actor: CombatActorInput;
}
