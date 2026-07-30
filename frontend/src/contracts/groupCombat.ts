import type { CombatParticipantPayload } from './socket';

export interface CombatTeamPayload {
  teamId: string;
  anchorActorId: string;
  sourceGroupId?: string;
  actorIds: string[];
}

declare module './socket' {
  interface CombatParticipantPayload {
    teamId?: string;
    withdrawn?: boolean;
  }

  interface CombatSnapshot {
    teams?: [CombatTeamPayload, CombatTeamPayload];
    winnerTeamId?: string;
  }
}

export type TeamCombatParticipant = CombatParticipantPayload & {
  teamId: string;
  withdrawn: boolean;
};
