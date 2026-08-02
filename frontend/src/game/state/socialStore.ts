import { useSyncExternalStore } from 'react';
import type { SocialDashboard } from '../../contracts/social';

const EMPTY: SocialDashboard = {
  listings: [],
  recentPlayers: [],
  contacts: [],
  blockedCharacterIds: [],
  activeMentorships: [],
  regionGoals: [],
  metrics: { fillRate: 0, lobbyDropoffRate: 0, mentoringCompletionRate: 0, rewardConcentration: 0 },
};
let snapshot = EMPTY;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
export const socialStore = {
  getSnapshot: (): SocialDashboard => snapshot,
  setSnapshot(next: SocialDashboard): void { snapshot = next; emit(); },
  reset(): void { snapshot = EMPTY; emit(); },
  subscribe(listener: () => void): () => void { listeners.add(listener); return () => listeners.delete(listener); },
};
export const useSocialState = (): SocialDashboard =>
  useSyncExternalStore(socialStore.subscribe, socialStore.getSnapshot, socialStore.getSnapshot);
