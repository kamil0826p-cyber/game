import type { SelfCharacterState } from '../../contracts/game';
import type { NpcStatePayload } from '../../contracts/socket';

export function canInteractWithNpc(self: SelfCharacterState, npc: NpcStatePayload): boolean {
  if (self.mapId !== npc.mapId) return false;
  return Math.max(Math.abs(npc.x - self.x), Math.abs(npc.y - self.y)) <= npc.interactionRadius;
}
