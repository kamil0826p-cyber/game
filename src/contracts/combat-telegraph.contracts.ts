import type { SkillRespecPayload } from './socket.schemas.js';
import type { SocketAck } from './socket.events.js';
import type { SkillTreeSnapshot } from '../modules/skills/skill.types.js';

export type CombatTelegraphCounterKind = 'INTERRUPT' | 'GUARD' | 'CLEANSE' | 'POSITION';

export interface CombatTelegraphPayload {
  id: string;
  key: string;
  actorId: string;
  targetActorId?: string;
  skillKey?: string;
  createdTurn: number;
  resolvesOnTurn: number;
  counterKinds: readonly CombatTelegraphCounterKind[];
  publicMetadata: Readonly<Record<string, string | number | boolean>>;
}

declare module './socket.events.js' {
  interface CombatSnapshot {
    telegraphs?: CombatTelegraphPayload[];
  }

  interface ClientToServerEvents {
    'skills:respec': (
      payload: SkillRespecPayload,
      acknowledgement?: (response: SocketAck<SkillTreeSnapshot>) => void,
    ) => void;
  }
}
