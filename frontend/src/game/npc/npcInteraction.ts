import { isActorWithinInteractionRange } from '../../../../src/common/rules/actor-interaction';
import type { SelfCharacterState } from '../../contracts/game';
import type { NpcStatePayload } from '../../contracts/socket';

export function canInteractWithNpc(self: SelfCharacterState, npc: NpcStatePayload): boolean {
  return isActorWithinInteractionRange(self, npc);
}
