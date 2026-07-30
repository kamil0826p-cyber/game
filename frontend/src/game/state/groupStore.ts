import { useSyncExternalStore } from 'react';
import type { GroupSnapshot } from '../../contracts/group';

const EMPTY_GROUP_SNAPSHOT: GroupSnapshot = { group: null, invites: [] };
let snapshot: GroupSnapshot = EMPTY_GROUP_SNAPSHOT;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const groupStore = {
  getSnapshot(): GroupSnapshot {
    return snapshot;
  },
  setSnapshot(next: GroupSnapshot): void {
    snapshot = next;
    emit();
  },
  reset(): void {
    snapshot = EMPTY_GROUP_SNAPSHOT;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function useGroupState(): GroupSnapshot {
  return useSyncExternalStore(groupStore.subscribe, groupStore.getSnapshot, groupStore.getSnapshot);
}
