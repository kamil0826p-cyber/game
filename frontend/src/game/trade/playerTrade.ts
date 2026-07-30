import type { PublicPlayerState, SelfCharacterState } from '../../contracts/game';
import { canInteractWithPlayer } from '../interactions/playerInteraction';

export function canTradeWithPlayer(
  self: Pick<SelfCharacterState, 'characterId' | 'mapId' | 'x' | 'y'>,
  player: Pick<PublicPlayerState, 'characterId' | 'mapId' | 'x' | 'y'>,
): boolean {
  return canInteractWithPlayer(self, player);
}
