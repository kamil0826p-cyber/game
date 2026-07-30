import type { QuestLogStatus, QuestNpcBindingPayload } from './quest.types';

export type QuestMarkerState = 'UNKNOWN' | 'NOT_STARTED' | QuestLogStatus;

const states = new Map<string, QuestLogStatus>();
const questByNpc = new Map<string, string>();
const listeners = new Set<() => void>();
let loaded = false;

function emit(): void {
  for (const listener of listeners) listener();
}

export function getQuestMarkerState(questKey: string): QuestMarkerState {
  if (!loaded) return 'UNKNOWN';
  return states.get(questKey) ?? 'NOT_STARTED';
}

export function getNpcQuestMarkerState(npcKey: string): QuestMarkerState {
  if (!loaded) return 'UNKNOWN';
  const questKey = questByNpc.get(npcKey);
  return questKey ? getQuestMarkerState(questKey) : 'UNKNOWN';
}

export function subscribeQuestMarkerState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function resetQuestMarkerStates(): void {
  loaded = false;
  states.clear();
  questByNpc.clear();
  emit();
}

export function replaceQuestMarkerStates(
  quests: readonly { key: string; status: QuestLogStatus }[],
  npcBindings: readonly QuestNpcBindingPayload[],
): void {
  loaded = true;
  states.clear();
  questByNpc.clear();
  for (const quest of quests) states.set(quest.key, quest.status);
  for (const binding of npcBindings) questByNpc.set(binding.npcKey, binding.questKey);
  emit();
}

export function updateQuestMarkerState(questKey: string, status: QuestLogStatus): void {
  loaded = true;
  states.set(questKey, status);
  emit();
}
