import type { CharacterClass } from '../../common/domain/game.types.js';

export interface OutfitDefinition {
  key: string;
  characterClass: CharacterClass;
  unlockLevel: number;
}

const levels = [1, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100] as const;
const createOutfits = (
  characterClass: CharacterClass,
  keys: readonly string[],
): readonly OutfitDefinition[] =>
  keys.map((key, index) => ({ key, characterClass, unlockLevel: levels[index] ?? 1 }));

export const OUTFIT_CATALOG: Readonly<Record<CharacterClass, readonly OutfitDefinition[]>> = {
  MAGE: createOutfits('MAGE', [
    'mage-apprentice',
    'mage-scholar',
    'mage-ember',
    'mage-frost',
    'mage-storm',
    'mage-enchanter',
    'mage-archmage',
    'mage-astral',
    'mage-void',
    'mage-royal',
    'mage-ascendant',
  ]),
  WARRIOR: createOutfits('WARRIOR', [
    'warrior-recruit',
    'warrior-iron',
    'warrior-guardian',
    'warrior-raider',
    'warrior-templar',
    'warrior-veteran',
    'warrior-champion',
    'warrior-warlord',
    'warrior-dragon',
    'warrior-royal',
    'warrior-immortal',
  ]),
  ARCHER: createOutfits('ARCHER', [
    'archer-scout',
    'archer-hunter',
    'archer-forest',
    'archer-desert',
    'archer-shadow',
    'archer-marksman',
    'archer-ranger',
    'archer-wind',
    'archer-moon',
    'archer-royal',
    'archer-starshot',
  ]),
};

export const getDefaultOutfit = (characterClass: CharacterClass): OutfitDefinition =>
  OUTFIT_CATALOG[characterClass][0]!;

export const getUnlockedOutfits = (
  characterClass: CharacterClass,
  level: number,
): OutfitDefinition[] =>
  OUTFIT_CATALOG[characterClass].filter((outfit) => outfit.unlockLevel <= level);

export const isOutfitUnlocked = (
  characterClass: CharacterClass,
  level: number,
  outfitKey: string,
): boolean =>
  OUTFIT_CATALOG[characterClass].some(
    (outfit) => outfit.key === outfitKey && outfit.unlockLevel <= level,
  );
