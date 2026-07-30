export type QuestLogStatus = 'ACTIVE' | 'READY' | 'REWARDED';
export interface QuestObjectivePayload {
  id: string;
  type: 'COLLECT_ITEM' | 'KILL_MOB' | 'TALK_TO_NPC';
  label: string;
  stage: number;
  active: boolean;
  current: number;
  target: number;
  completed: boolean;
}
export interface QuestNpcBindingPayload { npcKey: string; questKey: string; }
export interface QuestLogEntryPayload {
  key: string;
  name: string;
  description: string;
  status: QuestLogStatus;
  activeStage?: number;
  objectives: QuestObjectivePayload[];
  rewards: { experience: number; gold: number; silver: number };
  startedAt?: number;
  completedAt?: number;
}
export interface QuestLogSnapshot { quests: QuestLogEntryPayload[]; npcBindings: QuestNpcBindingPayload[]; }
