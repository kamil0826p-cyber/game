export interface EncounterEligibilityPayload {
  eligible: boolean;
  reason: 'ELIGIBLE' | 'WITHDRAWN' | 'AFK' | 'LATE_JOIN' | 'NO_CONTRIBUTION';
  score: number;
  activeTurnRatio: number;
}

export interface EncounterSnapshotPayload {
  key: string;
  version: number;
  name: string;
  difficulty: 'BASE' | 'CHALLENGING' | 'RITUAL';
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
  eligibility?: Record<string, EncounterEligibilityPayload>;
}

declare module './socket' {
  interface CombatSnapshot {
    encounter?: EncounterSnapshotPayload;
  }
}
