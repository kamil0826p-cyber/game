import type { CombatParticipantPayload } from './socket.events.js';

export interface CombatTeamPayload {
  teamId: string;
  anchorActorId: string;
  sourceGroupId?: string;
  actorIds: string[];
}

declare module './socket.events.js' {
  interface CombatParticipantPayload {
    teamId?: string;
    withdrawn?: boolean;
  }

  interface CombatSnapshot {
    teams?: [CombatTeamPayload, CombatTeamPayload];
    winnerTeamId?: string;
  }
}

export type TeamCombatParticipantPayload = CombatParticipantPayload & {
  teamId: string;
  withdrawn: boolean;
};
