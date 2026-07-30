import { isActorWithinInteractionRange } from '../../../../src/common/rules/actor-interaction';
import type { PublicPlayerState, SelfCharacterState } from '../../contracts/game';

export function canInteractWithPlayer(
  self: Pick<SelfCharacterState, 'characterId' | 'mapId' | 'x' | 'y'>,
  player: Pick<PublicPlayerState, 'characterId' | 'mapId' | 'x' | 'y'>,
): boolean {
  return self.characterId !== player.characterId && isActorWithinInteractionRange(self, player);
}
