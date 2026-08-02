import type { Direction } from '../../../common/domain/game.types.js';

export interface WorldActorPosition {
  mapId: string;
  x: number;
  y: number;
  direction: Direction;
}

export interface NpcDefinitionContract extends WorldActorPosition {
  key: string;
  name: string;
  outfitKey: string;
  dialogueTree: Record<string, unknown>;
}

export interface MobDefinitionContract extends WorldActorPosition {
  key: string;
  encounterKey: string;
  name: string;
  level: number;
  outfitKey: string;
  stats: Record<string, number>;
  lootTable: Array<Record<string, unknown>>;
  respawnMs: number;
}

export interface MobRuntimeState extends MobDefinitionContract {
  instanceId: string;
  currentHp: number;
  state: 'IDLE' | 'ROAMING' | 'AGGRO' | 'IN_BATTLE' | 'DEAD';
  respawnAt?: number;
}
