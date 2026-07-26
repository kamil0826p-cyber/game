import type { CharacterClass } from '../../common/domain/game.types.js';

export interface OutfitDefinition {
  key: string;
  characterClass: CharacterClass;
  unlockLevel: number;
}

export const OUTFIT_CATALOG: Readonly<Record<CharacterClass, readonly OutfitDefinition[]>> = {
  MAGE: [
    { key: 'mage-apprentice', characterClass: 'MAGE', unlockLevel: 1 },
    { key: 'mage-archmage', characterClass: 'MAGE', unlockLevel: 10 },
  ],
  WARRIOR: [
    { key: 'warrior-recruit', characterClass: 'WARRIOR', unlockLevel: 1 },
    { key: 'warrior-champion', characterClass: 'WARRIOR', unlockLevel: 10 },
  ],
  ARCHER: [
    { key: 'archer-scout', characterClass: 'ARCHER', unlockLevel: 1 },
    { key: 'archer-ranger', characterClass: 'ARCHER', unlockLevel: 10 },
  ],
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
