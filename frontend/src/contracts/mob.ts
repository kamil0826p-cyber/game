import type { CharacterClass, SelfCharacterState } from './game';
import type {
  CombatSnapshot,
  ItemRarity,
  ItemStatBonuses,
  SocketAck,
} from './socket';

export type MobRank = 'SPAWN' | 'EXECUTIONER' | 'ARCH_EXECUTIONER' | 'REAPER' | 'ANCIENT';

export interface MobStatePayload {
  id: string;
  definitionKey: string;
  name: string;
  rank: MobRank;
  mapId: string;
  x: number;
  y: number;
  level: number;
  outfitKey: string;
  renderScale: number;
}

export interface MobLootRewardPayload {
  itemKey: string;
  name: string;
  description: string;
  rarity: ItemRarity;
  icon: string;
  quantity: number;
  stackLimit: number;
  requiredClass?: CharacterClass;
  minimumLevel: number;
  statBonuses: ItemStatBonuses;
  effect?: { hp?: number; energy?: number };
}

export interface MobRewardPayload {
  mobId: string;
  mobName: string;
  experienceGained: number;
  levelsGained: number;
  skillPointsGained: number;
  nextLevelExperience: number | null;
  loot: MobLootRewardPayload[];
  skippedLoot: MobLootRewardPayload[];
  self: SelfCharacterState;
}

declare module './socket' {
  interface CombatParticipantPayload {
    renderScale?: number;
  }
  interface ClientToServerEvents {
    'mobs:get': (
      payload: { requestId: string },
      acknowledgement: (response: SocketAck<{ mapId: string; mobs: MobStatePayload[] }>) => void,
    ) => void;
    'pve:getActive': (
      payload: { requestId: string },
      acknowledgement: (response: SocketAck<CombatSnapshot | null>) => void,
    ) => void;
    'pve:request': (
      payload: { requestId: string; mobId: string },
      acknowledgement: (response: SocketAck<CombatSnapshot>) => void,
    ) => void;
    'pve:act': (
      payload:
        | { requestId: string; combatId: string; action: 'BASIC_ATTACK' }
        | { requestId: string; combatId: string; action: 'SKILL'; skillKey: string },
      acknowledgement: (response: SocketAck<CombatSnapshot>) => void,
    ) => void;
    'pve:leave': (
      payload: { requestId: string; combatId: string },
      acknowledgement: (response: SocketAck<CombatSnapshot>) => void,
    ) => void;
  }
  interface ServerToClientEvents {
    'world:mobSpawned': (payload: MobStatePayload) => void;
    'world:mobDespawned': (payload: { mobId: string; respawnsAt: number }) => void;
    'mob:rewards': (payload: MobRewardPayload) => void;
  }
}
