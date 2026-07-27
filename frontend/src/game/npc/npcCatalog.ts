export type NpcType = 'DIALOGUE' | 'MERCHANT' | 'QUEST';

export interface NpcDefinition {
  key: string;
  name: string;
  type: NpcType;
  mapKey: string;
  x: number;
  y: number;
  interactionRadius: number;
}

export const NPC_DEFINITIONS: readonly NpcDefinition[] = [
  {
    key: 'quartermaster',
    name: 'Borin Żelazna Dłoń',
    type: 'MERCHANT',
    mapKey: 'greenfields',
    x: 6,
    y: 4,
    interactionRadius: 2,
  },
];

export const npcsForMap = (mapKey: string): readonly NpcDefinition[] =>
  NPC_DEFINITIONS.filter((npc) => npc.mapKey === mapKey);
