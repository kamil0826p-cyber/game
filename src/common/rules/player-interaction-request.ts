import type { ZoneType } from '../domain/game.types.js';

export const PLAYER_INTERACTION_REQUEST_TTL_MS = 30_000;

export type PvpEngagementPolicy = 'FORBIDDEN' | 'CONSENT' | 'IMMEDIATE';

export function getPvpEngagementPolicy(zoneType: ZoneType): PvpEngagementPolicy {
  switch (zoneType) {
    case 'SAFE':
      return 'FORBIDDEN';
    case 'OUTLAW':
      return 'CONSENT';
    case 'PVP':
      return 'IMMEDIATE';
  }
}
