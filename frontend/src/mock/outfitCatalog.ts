import type { CharacterClass } from '../contracts/game';

export interface ClientOutfitDefinition {
  key: string;
  label: string;
  characterClass: CharacterClass;
  unlockLevel: number;
  description: string;
}

export const OUTFIT_CATALOG: Readonly<Record<CharacterClass, readonly ClientOutfitDefinition[]>> = {
  MAGE: [
    {
      key: 'mage-apprentice',
      label: 'Apprentice Robes',
      characterClass: 'MAGE',
      unlockLevel: 1,
      description: 'Blue academy robes with a crystal-tipped staff.',
    },
    {
      key: 'mage-archmage',
      label: 'Archmage Regalia',
      characterClass: 'MAGE',
      unlockLevel: 10,
      description: 'Violet ceremonial robes trimmed with gold.',
    },
  ],
  WARRIOR: [
    {
      key: 'warrior-recruit',
      label: 'Recruit Armor',
      characterClass: 'WARRIOR',
      unlockLevel: 1,
      description: 'Reliable steel armor with a red field sash.',
    },
    {
      key: 'warrior-champion',
      label: 'Champion Plate',
      characterClass: 'WARRIOR',
      unlockLevel: 10,
      description: 'Golden plate and a crimson champion mantle.',
    },
  ],
  ARCHER: [
    {
      key: 'archer-scout',
      label: 'Scout Leathers',
      characterClass: 'ARCHER',
      unlockLevel: 1,
      description: 'Forest leathers designed for quiet movement.',
    },
    {
      key: 'archer-ranger',
      label: 'Ranger Garb',
      characterClass: 'ARCHER',
      unlockLevel: 10,
      description: 'Dark teal gear worn by veteran pathfinders.',
    },
  ],
};

export const CLASS_PRESENTATION: Readonly<
  Record<CharacterClass, { label: string; role: string; description: string; accent: string }>
> = {
  MAGE: {
    label: 'Mage',
    role: 'Arcane specialist',
    description: 'High energy and intelligence with fragile defenses.',
    accent: 'text-violet-300',
  },
  WARRIOR: {
    label: 'Warrior',
    role: 'Armored vanguard',
    description: 'High health, strength, and armor for close combat.',
    accent: 'text-rose-300',
  },
  ARCHER: {
    label: 'Archer',
    role: 'Agile marksman',
    description: 'High agility with balanced health and energy.',
    accent: 'text-emerald-300',
  },
};

export const outfitImageUrl = (outfitKey: string): string =>
  `/assets/sprites/${encodeURIComponent(outfitKey)}.png`;
