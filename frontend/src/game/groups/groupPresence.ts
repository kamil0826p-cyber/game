import { groupStore } from '../state/groupStore';

export function isGroupMate(characterId: string): boolean {
  return Boolean(
    groupStore
      .getSnapshot()
      .group?.members.some((member) => member.characterId === characterId),
  );
}

export function subscribeGroupPresence(listener: () => void): () => void {
  return groupStore.subscribe(listener);
}
