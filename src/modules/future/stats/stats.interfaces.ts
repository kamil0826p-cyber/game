export interface MutableResourceState {
  current: number;
  maximum: number;
}

export interface CharacterStatsState {
  hp: MutableResourceState;
  energy: MutableResourceState;
  strength: number;
  agility: number;
  intelligence: number;
  armor: number;
  derived: {
    attackPower: number;
    spellPower: number;
    criticalChance: number;
    dodgeChance: number;
  };
}
