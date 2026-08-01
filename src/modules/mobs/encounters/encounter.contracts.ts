import type { EncounterDifficulty, EncounterEligibility } from './encounter.types.js';

export interface EncounterSnapshotPayload {
  key: string;
  version: number;
  name: string;
  difficulty: EncounterDifficulty;
  rootMobId: string;
  phaseKey: string;
  phaseLabel: string;
  phaseIndex: number;
  phaseCount: number;
  arenaModifier?: string;
  mechanics: string[];
  partySize: number;
  recommendedPartySize: number;
  minimumPartySize: number;
  maximumPartySize: number;
  scaling: {
    healthMultiplier: number;
    powerMultiplier: number;
    telegraphTargetCount: number;
    breakCapacity: number;
    targetTurns: number;
  };
  eligibility?: Record<string, EncounterEligibility>;
}

declare module '../../../contracts/socket.events.js' {
  interface CombatSnapshot {
    encounter?: EncounterSnapshotPayload;
  }
}
