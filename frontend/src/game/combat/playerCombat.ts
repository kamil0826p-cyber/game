import { getPvpEngagementPolicy } from '../../../../src/common/rules/player-interaction-request';
import type { PublicPlayerState, SelfCharacterState, ZoneType } from '../../contracts/game';
import { canInteractWithPlayer } from '../interactions/playerInteraction';

export type PlayerCombatAvailability =
  'AVAILABLE_WITH_CONSENT' | 'AVAILABLE_IMMEDIATELY' | 'SAFE_ZONE' | 'TOO_FAR' | 'SELF';

export function getPlayerCombatAvailability(
  self: Pick<SelfCharacterState, 'characterId' | 'mapId' | 'x' | 'y'>,
  player: Pick<PublicPlayerState, 'characterId' | 'mapId' | 'x' | 'y'>,
  zoneType: ZoneType,
): PlayerCombatAvailability {
  if (self.characterId === player.characterId) return 'SELF';
  if (!canInteractWithPlayer(self, player)) return 'TOO_FAR';
  const policy = getPvpEngagementPolicy(zoneType);
  if (policy === 'FORBIDDEN') return 'SAFE_ZONE';
  return policy === 'CONSENT' ? 'AVAILABLE_WITH_CONSENT' : 'AVAILABLE_IMMEDIATELY';
}
