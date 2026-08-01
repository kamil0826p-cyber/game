import type { CharacterClass } from '../../common/domain/game.types.js';
import { SKILL_CATALOG, skillsForClass } from './skill.catalog.js';
import {
  SKILL_BUILD_RULES_VERSION,
  type SkillBuildCatalog,
  type SkillBuildNodeDefinition,
  type SkillModifierOperation,
  type SkillSpecializationDefinition,
} from './skill.buildcraft.types.js';

const modifier = (
  type: SkillModifierOperation['type'],
  payload: Omit<SkillModifierOperation, 'version' | 'type'>,
): SkillModifierOperation => ({ version: 1, type, ...payload } as SkillModifierOperation);

export const SKILL_SPECIALIZATIONS = [
  {
    key: 'mage-arcanist',
    characterClass: 'MAGE',
    name: 'Arcanist',
    promise: 'Precise arcane bursts and control over enemy tempo.',
    role: 'CONTROL',
    soloLoop: 'Build an opening with Arcane Spark, then lock or burst the exposed target.',
    groupSynergies: [
      'Creates predictable control windows for heavy allied attacks.',
      'Can reach protected back-line targets for coordinated focus fire.',
    ],
    threatResponse: 'Time manipulation interrupts dangerous enemy turns.',
    drawback: 'Long control cooldowns punish poor target selection.',
    icon: '✦',
  },
  {
    key: 'mage-pyromancer',
    characterClass: 'MAGE',
    name: 'Pyromancer',
    promise: 'Escalating fire damage that converts setup into explosive finishes.',
    role: 'DAMAGE',
    soloLoop: 'Apply burn, pressure the target, then consume a team setup with Meteor.',
    groupSynergies: [
      'Adds persistent burn pressure that rewards target focus.',
      'Consumes EXPOSED or STAGGER windows for a coordinated finisher.',
    ],
    threatResponse: 'High immediate damage can remove a telegraphing threat before resolution.',
    drawback: 'Higher energy pressure and limited defensive utility.',
    icon: '☄',
  },
  {
    key: 'mage-cryomancer',
    characterClass: 'MAGE',
    name: 'Cryomancer',
    promise: 'Formation control, shields, and deliberate attrition.',
    role: 'SUPPORT',
    soloLoop: 'Slow the enemy front, shield through retaliation, then reopen control.',
    groupSynergies: [
      'Protects allies while they finish long telegraphs.',
      'Slows clustered formations for allied row attacks.',
    ],
    threatResponse: 'Barrier and slow reduce the impact of burst turns.',
    drawback: 'Lower peak damage and dependence on turn planning.',
    icon: '❄',
  },
  {
    key: 'warrior-vanguard',
    characterClass: 'WARRIOR',
    name: 'Vanguard',
    promise: 'Front-line protection and reliable control of enemy access.',
    role: 'DEFENSE',
    soloLoop: 'Guard, stagger the priority threat, then survive its counterattack.',
    groupSynergies: [
      'Creates safe turns for fragile back-line allies.',
      'Keeps enemies in the front row for allied area pressure.',
    ],
    threatResponse: 'Shield Bash and defensive cooldowns answer telegraphed attacks.',
    drawback: 'Lower personal damage when protection tools are committed.',
    icon: '◈',
  },
  {
    key: 'warrior-berserker',
    characterClass: 'WARRIOR',
    name: 'Berserker',
    promise: 'Relentless physical pressure and decisive execution windows.',
    role: 'DAMAGE',
    soloLoop: 'Cleave through the front, gain momentum, then execute a wounded target.',
    groupSynergies: [
      'Consumes BLEED or EXPOSED created by allies.',
      'Forces defensive reactions that open space for allied casters.',
    ],
    threatResponse: 'Execution can remove a dangerous low-health actor immediately.',
    drawback: 'Reduced control and expensive offensive turns.',
    icon: '†',
  },
  {
    key: 'warrior-warlord',
    characterClass: 'WARRIOR',
    name: 'Warlord',
    promise: 'Team tempo, formation pressure, and durable battlefield leadership.',
    role: 'HYBRID',
    soloLoop: 'Use Battle Cry to establish tempo, then pressure an entire formation row.',
    groupSynergies: [
      'Haste windows improve coordinated burst sequences.',
      'Row pressure complements marks, slows, and protected casts.',
    ],
    threatResponse: 'Last Stand stabilizes after an enemy burst turn.',
    drawback: 'Power is spread between offense and support rather than maximized.',
    icon: '♛',
  },
  {
    key: 'archer-sharpshooter',
    characterClass: 'ARCHER',
    name: 'Sharpshooter',
    promise: 'Precise back-line pressure and armor-piercing finishers.',
    role: 'DAMAGE',
    soloLoop: 'Mark a priority target, pierce its defenses, then finish with Perfect Hunt.',
    groupSynergies: [
      'Turns allied EXPOSED windows into reliable single-target damage.',
      'Removes protected back-line threats before they complete a plan.',
    ],
    threatResponse: 'Long-range focus can eliminate dangerous casters.',
    drawback: 'Weak area control and little recovery after a missed timing window.',
    icon: '➳',
  },
  {
    key: 'archer-trapper',
    characterClass: 'ARCHER',
    name: 'Trapper',
    promise: 'Control chains, bleed setup, and punishment of predictable movement.',
    role: 'CONTROL',
    soloLoop: 'Root a target, spread pressure with Volley, then exploit the controlled row.',
    groupSynergies: [
      'Roots targets for allied telegraphs and row attacks.',
      'Creates BLEED for finishers and sustained pressure.',
    ],
    threatResponse: 'Snare Trap denies a dangerous target its preferred access.',
    drawback: 'Setup turns deal less immediate damage.',
    icon: '⌘',
  },
  {
    key: 'archer-pathfinder',
    characterClass: 'ARCHER',
    name: 'Pathfinder',
    promise: 'Mobility, flexible targeting, and resilient skirmishing.',
    role: 'HYBRID',
    soloLoop: 'Use Evasive Roll to create tempo, reposition pressure, and keep firing.',
    groupSynergies: [
      'Repositions safely around protected allies and row pressure.',
      'Marks targets while preserving energy for reactions.',
    ],
    threatResponse: 'Evasion answers focused physical burst.',
    drawback: 'Lower maximum damage than a dedicated Sharpshooter.',
    icon: '⤾',
  },
] as const satisfies readonly SkillSpecializationDefinition[];

interface SpecNodeInput {
  specializationKey: string;
  passive: {
    key: string;
    name: string;
    description: string;
    skillKey: string;
    operation: SkillModifierOperation;
  };
  techniques: readonly [
    {
      key: string;
      name: string;
      description: string;
      skillKey: string;
      operation: SkillModifierOperation;
    },
    {
      key: string;
      name: string;
      description: string;
      skillKey: string;
      operation: SkillModifierOperation;
    },
  ];
  keystone: {
    key: string;
    name: string;
    description: string;
    skillKey: string;
    operations: readonly SkillModifierOperation[];
  };
}

const specNodeInputs: readonly SpecNodeInput[] = [
  {
    specializationKey: 'mage-arcanist',
    passive: {
      key: 'mage-arcanist-resonance',
      name: 'Resonant Focus',
      description: 'Each rank strengthens Arcane Spark without changing its role.',
      skillKey: 'mage-arcane-spark',
      operation: modifier('SCALE_EFFECT', { effectType: 'DAMAGE', multiplier: 1.06 }),
    },
    techniques: [
      {
        key: 'mage-arcanist-fractured-ray',
        name: 'Fractured Ray',
        description: 'Arcane Spark can target the enemy back row, with a modest damage bonus.',
        skillKey: 'mage-arcane-spark',
        operation: modifier('SET_TARGETING', {
          targeting: 'BACK_ROW',
          coefficientMultiplier: 1.08,
        }),
      },
      {
        key: 'mage-arcanist-efficient-lock',
        name: 'Efficient Lock',
        description: 'Time Lock costs less energy but remains a long-cooldown control tool.',
        skillKey: 'mage-time-lock',
        operation: modifier('ADJUST_ENERGY_COST', { flatDelta: -6, minimum: 10 }),
      },
    ],
    keystone: {
      key: 'mage-arcanist-chrono-collapse',
      name: 'Chrono Collapse',
      description: 'Elemental Cataclysm hits harder but gains one turn of cooldown.',
      skillKey: 'mage-elemental-cataclysm',
      operations: [
        modifier('SCALE_EFFECT', { effectType: 'DAMAGE', multiplier: 1.2 }),
        modifier('ADJUST_COOLDOWN', { flatDelta: 1, minimum: 0 }),
      ],
    },
  },
  {
    specializationKey: 'mage-pyromancer',
    passive: {
      key: 'mage-pyromancer-kindling',
      name: 'Kindling',
      description: 'Each rank increases Flame Orb damage.',
      skillKey: 'mage-flame-orb',
      operation: modifier('SCALE_EFFECT', { effectType: 'DAMAGE', multiplier: 1.06 }),
    },
    techniques: [
      {
        key: 'mage-pyromancer-searing-lance',
        name: 'Searing Lance',
        description: 'Ember Lance also applies a short burn.',
        skillKey: 'mage-ember-lance',
        operation: modifier('ADD_STATUS_EFFECT', {
          statusKey: 'BURN',
          durationTurns: 2,
          magnitude: 0.2,
        }),
      },
      {
        key: 'mage-pyromancer-conserved-flame',
        name: 'Conserved Flame',
        description: 'Meteor costs less energy at the price of no direct damage increase.',
        skillKey: 'mage-meteor',
        operation: modifier('ADJUST_ENERGY_COST', { flatDelta: -8, minimum: 18 }),
      },
    ],
    keystone: {
      key: 'mage-pyromancer-ashen-verdict',
      name: 'Ashen Verdict',
      description: 'Meteor consumes EXPOSED for a coordinated heavy hit.',
      skillKey: 'mage-meteor',
      operations: [modifier('CONSUME_STATUS', { statusKey: 'EXPOSED' })],
    },
  },
  {
    specializationKey: 'mage-cryomancer',
    passive: {
      key: 'mage-cryomancer-deep-freeze',
      name: 'Deep Freeze',
      description: 'Each rank improves Frost Nova damage.',
      skillKey: 'mage-frost-nova',
      operation: modifier('SCALE_EFFECT', { effectType: 'DAMAGE', multiplier: 1.05 }),
    },
    techniques: [
      {
        key: 'mage-cryomancer-front-nova',
        name: 'Glacial Front',
        description: 'Frost Nova concentrates on the enemy front row and hits harder.',
        skillKey: 'mage-frost-nova',
        operation: modifier('SET_TARGETING', {
          targeting: 'FRONT_ROW',
          coefficientMultiplier: 1.18,
        }),
      },
      {
        key: 'mage-cryomancer-thin-ice',
        name: 'Thin Ice',
        description: 'Ice Barrier costs less energy.',
        skillKey: 'mage-ice-barrier',
        operation: modifier('ADJUST_ENERGY_COST', { flatDelta: -5, minimum: 8 }),
      },
    ],
    keystone: {
      key: 'mage-cryomancer-whiteout',
      name: 'Whiteout',
      description: 'Frost Nova applies a stronger slow but gains one cooldown turn.',
      skillKey: 'mage-frost-nova',
      operations: [
        modifier('ADD_STATUS_EFFECT', {
          statusKey: 'SLOWED',
          durationTurns: 2,
          magnitude: 0.4,
        }),
        modifier('ADJUST_COOLDOWN', { flatDelta: 1, minimum: 0 }),
      ],
    },
  },
  {
    specializationKey: 'warrior-vanguard',
    passive: {
      key: 'warrior-vanguard-braced',
      name: 'Braced',
      description: 'Each rank strengthens Iron Guard.',
      skillKey: 'warrior-iron-guard',
      operation: modifier('SCALE_EFFECT', { effectType: 'APPLY_STATUS', multiplier: 1.08 }),
    },
    techniques: [
      {
        key: 'warrior-vanguard-linebreaker',
        name: 'Linebreaker',
        description: 'Shield Bash targets the enemy front row.',
        skillKey: 'warrior-shield-bash',
        operation: modifier('SET_TARGETING', {
          targeting: 'FRONT_ROW',
          coefficientMultiplier: 1.08,
        }),
      },
      {
        key: 'warrior-vanguard-cheap-guard',
        name: 'Measured Guard',
        description: 'Iron Guard costs less energy.',
        skillKey: 'warrior-iron-guard',
        operation: modifier('ADJUST_ENERGY_COST', { flatDelta: -5, minimum: 5 }),
      },
    ],
    keystone: {
      key: 'warrior-vanguard-unyielding-line',
      name: 'Unyielding Line',
      description: 'Last Stand provides an additional defensive status.',
      skillKey: 'warrior-last-stand',
      operations: [
        modifier('ADD_STATUS_EFFECT', {
          statusKey: 'GUARD',
          durationTurns: 2,
          magnitude: 0.25,
        }),
      ],
    },
  },
  {
    specializationKey: 'warrior-berserker',
    passive: {
      key: 'warrior-berserker-rage',
      name: 'Rage',
      description: 'Each rank improves Cleave damage.',
      skillKey: 'warrior-cleave',
      operation: modifier('SCALE_EFFECT', { effectType: 'DAMAGE', multiplier: 1.06 }),
    },
    techniques: [
      {
        key: 'warrior-berserker-blood-price',
        name: 'Blood Price',
        description: 'Execution costs less energy.',
        skillKey: 'warrior-execution',
        operation: modifier('ADJUST_ENERGY_COST', { flatDelta: -7, minimum: 12 }),
      },
      {
        key: 'warrior-berserker-front-whirlwind',
        name: 'Crushing Circle',
        description: 'Whirlwind focuses the enemy front row and gains damage.',
        skillKey: 'warrior-whirlwind',
        operation: modifier('SET_TARGETING', {
          targeting: 'FRONT_ROW',
          coefficientMultiplier: 1.15,
        }),
      },
    ],
    keystone: {
      key: 'warrior-berserker-blood-execution',
      name: 'Blood Execution',
      description: 'Execution consumes BLEED for a coordinated finisher.',
      skillKey: 'warrior-execution',
      operations: [modifier('CONSUME_STATUS', { statusKey: 'BLEED' })],
    },
  },
  {
    specializationKey: 'warrior-warlord',
    passive: {
      key: 'warrior-warlord-command',
      name: 'Command Presence',
      description: 'Each rank strengthens Battle Cry effects.',
      skillKey: 'warrior-battle-cry',
      operation: modifier('SCALE_EFFECT', { effectType: 'APPLY_STATUS', multiplier: 1.06 }),
    },
    techniques: [
      {
        key: 'warrior-warlord-disciplined-cry',
        name: 'Disciplined Cry',
        description: 'Battle Cry costs less energy.',
        skillKey: 'warrior-battle-cry',
        operation: modifier('ADJUST_ENERGY_COST', { flatDelta: -5, minimum: 8 }),
      },
      {
        key: 'warrior-warlord-front-cleave',
        name: 'Ordered Advance',
        description: 'Cleave focuses the front row with improved damage.',
        skillKey: 'warrior-cleave',
        operation: modifier('SET_TARGETING', {
          targeting: 'FRONT_ROW',
          coefficientMultiplier: 1.12,
        }),
      },
    ],
    keystone: {
      key: 'warrior-warlord-iron-march',
      name: 'Iron March',
      description: 'Unbreakable Assault applies STAGGER to support team combos.',
      skillKey: 'warrior-unbreakable-assault',
      operations: [
        modifier('ADD_STATUS_EFFECT', {
          statusKey: 'STAGGER',
          durationTurns: 1,
          magnitude: 0.25,
          chance: 0.65,
        }),
      ],
    },
  },
  {
    specializationKey: 'archer-sharpshooter',
    passive: {
      key: 'archer-sharpshooter-aim',
      name: 'Steady Aim',
      description: 'Each rank improves Piercing Arrow damage.',
      skillKey: 'archer-piercing-arrow',
      operation: modifier('SCALE_EFFECT', { effectType: 'DAMAGE', multiplier: 1.06 }),
    },
    techniques: [
      {
        key: 'archer-sharpshooter-backline',
        name: 'Back-line Sight',
        description: 'Quick Shot targets the enemy back row.',
        skillKey: 'archer-quick-shot',
        operation: modifier('SET_TARGETING', {
          targeting: 'BACK_ROW',
          coefficientMultiplier: 1.08,
        }),
      },
      {
        key: 'archer-sharpshooter-efficient-pierce',
        name: 'Efficient Pierce',
        description: 'Piercing Arrow costs less energy.',
        skillKey: 'archer-piercing-arrow',
        operation: modifier('ADJUST_ENERGY_COST', { flatDelta: -4, minimum: 6 }),
      },
    ],
    keystone: {
      key: 'archer-sharpshooter-perfect-window',
      name: 'Perfect Window',
      description: 'Perfect Hunt consumes EXPOSED for maximum coordinated pressure.',
      skillKey: 'archer-perfect-hunt',
      operations: [modifier('CONSUME_STATUS', { statusKey: 'EXPOSED' })],
    },
  },
  {
    specializationKey: 'archer-trapper',
    passive: {
      key: 'archer-trapper-barbed',
      name: 'Barbed Traps',
      description: 'Each rank improves Snare Trap damage.',
      skillKey: 'archer-snare-trap',
      operation: modifier('SCALE_EFFECT', { effectType: 'DAMAGE', multiplier: 1.05 }),
    },
    techniques: [
      {
        key: 'archer-trapper-front-volley',
        name: 'Kill Zone',
        description: 'Volley focuses the enemy front row and gains damage.',
        skillKey: 'archer-volley',
        operation: modifier('SET_TARGETING', {
          targeting: 'FRONT_ROW',
          coefficientMultiplier: 1.15,
        }),
      },
      {
        key: 'archer-trapper-light-snare',
        name: 'Light Snare',
        description: 'Snare Trap costs less energy.',
        skillKey: 'archer-snare-trap',
        operation: modifier('ADJUST_ENERGY_COST', { flatDelta: -5, minimum: 6 }),
      },
    ],
    keystone: {
      key: 'archer-trapper-hemorrhage',
      name: 'Hemorrhage',
      description: 'Rain of Arrows applies an additional bleed setup.',
      skillKey: 'archer-rain-of-arrows',
      operations: [
        modifier('ADD_STATUS_EFFECT', {
          statusKey: 'BLEED',
          durationTurns: 3,
          magnitude: 0.35,
        }),
      ],
    },
  },
  {
    specializationKey: 'archer-pathfinder',
    passive: {
      key: 'archer-pathfinder-momentum',
      name: 'Momentum',
      description: 'Each rank strengthens Evasive Roll effects.',
      skillKey: 'archer-evasive-roll',
      operation: modifier('SCALE_EFFECT', { effectType: 'APPLY_STATUS', multiplier: 1.06 }),
    },
    techniques: [
      {
        key: 'archer-pathfinder-cheap-roll',
        name: 'Economical Roll',
        description: 'Evasive Roll costs less energy.',
        skillKey: 'archer-evasive-roll',
        operation: modifier('ADJUST_ENERGY_COST', { flatDelta: -5, minimum: 6 }),
      },
      {
        key: 'archer-pathfinder-back-mark',
        name: 'Flanking Mark',
        description: 'Predator’s Mark targets the enemy back row.',
        skillKey: 'archer-predators-mark',
        operation: modifier('SET_TARGETING', { targeting: 'BACK_ROW' }),
      },
    ],
    keystone: {
      key: 'archer-pathfinder-relentless-hunt',
      name: 'Relentless Hunt',
      description: 'Perfect Hunt gains damage but one additional cooldown turn.',
      skillKey: 'archer-perfect-hunt',
      operations: [
        modifier('SCALE_EFFECT', { effectType: 'DAMAGE', multiplier: 1.18 }),
        modifier('ADJUST_COOLDOWN', { flatDelta: 1, minimum: 0 }),
      ],
    },
  },
];

const specializationByKey = new Map<string, SkillSpecializationDefinition>(
  SKILL_SPECIALIZATIONS.map((specialization) => [specialization.key, specialization]),
);

const activeMaxRank = (displayOrder: number): number => {
  if (displayOrder <= 3) return 3;
  if (displayOrder <= 7) return 2;
  return 1;
};

export const activeSkillNodesForClass = (
  characterClass: CharacterClass,
): SkillBuildNodeDefinition[] =>
  skillsForClass(characterClass).map((skill) => ({
    key: skill.key,
    characterClass,
    kind: 'ACTIVE',
    name: skill.name,
    description: skill.description,
    minimumLevel: skill.minimumLevel,
    maxRank: activeMaxRank(skill.displayOrder),
    pointCost: 1,
    passiveCost: 0,
    prerequisiteKeys: skill.prerequisiteKeys,
    icon: skill.icon,
  }));

const specializationNodes = specNodeInputs.flatMap((input): SkillBuildNodeDefinition[] => {
  const specialization = specializationByKey.get(input.specializationKey)!;
  const techniqueChoice = `${input.specializationKey}:technique`;
  const passiveKey = input.passive.key;
  const techniqueKeys = input.techniques.map((entry) => entry.key);
  return [
    {
      key: passiveKey,
      characterClass: specialization.characterClass,
      specializationKey: specialization.key,
      kind: 'PASSIVE',
      name: input.passive.name,
      description: input.passive.description,
      minimumLevel: 15,
      maxRank: 3,
      pointCost: 1,
      passiveCost: 1,
      prerequisiteKeys: [],
      modifiesSkillKey: input.passive.skillKey,
      modifiersByRank: [
        [input.passive.operation],
        [input.passive.operation],
        [input.passive.operation],
      ],
      icon: specialization.icon,
    },
    ...input.techniques.map(
      (entry): SkillBuildNodeDefinition => ({
        key: entry.key,
        characterClass: specialization.characterClass,
        specializationKey: specialization.key,
        kind: 'MODIFIER',
        name: entry.name,
        description: entry.description,
        minimumLevel: 25,
        maxRank: 1,
        pointCost: 1,
        passiveCost: 1,
        prerequisiteKeys: [passiveKey],
        choiceGroupKey: techniqueChoice,
        modifiesSkillKey: entry.skillKey,
        modifiersByRank: [[entry.operation]],
        icon: specialization.icon,
      }),
    ),
    {
      key: input.keystone.key,
      characterClass: specialization.characterClass,
      specializationKey: specialization.key,
      kind: 'KEYSTONE',
      name: input.keystone.name,
      description: input.keystone.description,
      minimumLevel: 40,
      maxRank: 1,
      pointCost: 2,
      passiveCost: 2,
      prerequisiteKeys: [passiveKey],
      prerequisiteAnyOf: [techniqueKeys],
      choiceGroupKey: `${specialization.characterClass}:keystone`,
      modifiesSkillKey: input.keystone.skillKey,
      modifiersByRank: [input.keystone.operations],
      icon: specialization.icon,
    },
  ];
});

export const SKILL_BUILD_CATALOG: SkillBuildCatalog = {
  version: SKILL_BUILD_RULES_VERSION,
  specializations: SKILL_SPECIALIZATIONS,
  nodes: [
    ...SKILL_CATALOG.flatMap((skill) => activeSkillNodesForClass(skill.characterClass).filter((node) => node.key === skill.key)),
    ...specializationNodes,
  ],
};

export const skillBuildNodesForClass = (
  characterClass: CharacterClass,
): readonly SkillBuildNodeDefinition[] =>
  SKILL_BUILD_CATALOG.nodes.filter((node) => node.characterClass === characterClass);

export const skillSpecializationsForClass = (
  characterClass: CharacterClass,
): readonly SkillSpecializationDefinition[] =>
  SKILL_SPECIALIZATIONS.filter(
    (specialization) => specialization.characterClass === characterClass,
  );

export const findSkillBuildNode = (key: string): SkillBuildNodeDefinition | undefined =>
  SKILL_BUILD_CATALOG.nodes.find((node) => node.key === key);
