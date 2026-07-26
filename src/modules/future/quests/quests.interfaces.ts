export type QuestStatus =
  | 'NOT_STARTED'
  | 'ACTIVE'
  | 'COMPLETED'
  | 'REWARDED'
  | 'FAILED';

export interface QuestObjectiveDefinition {
  key: string;
  type: 'KILL' | 'COLLECT' | 'VISIT' | 'TALK';
  targetKey: string;
  requiredAmount: number;
}

export interface QuestDefinitionContract {
  key: string;
  name: string;
  description: string;
  minimumLevel: number;
  objectives: QuestObjectiveDefinition[];
  rewards: Record<string, unknown>;
}

export interface CharacterQuestState {
  questKey: string;
  status: QuestStatus;
  objectiveProgress: Record<string, number>;
}
