import type { CharacterClass } from '../../common/domain/game.types.js';

export interface OutfitDefinition {
  key: string;
  characterClass: CharacterClass;
  unlockLevel: number;
}

export const OUTFIT_CATALOG: Readonly<Record<CharacterClass, readonly OutfitDefinition[]>> = {
  MAGE: [
    { key: 'mage-apprentice', characterClass: 'MAGE', unlockLevel: 1 },
    { key: 'mage-scholar', characterClass: 'MAGE', unlockLevel: 1 },
    { key: 'mage-evoker', characterClass: 'MAGE', unlockLevel: 5 },
    { key: 'mage-archmage', characterClass: 'MAGE', unlockLevel: 10 },
    { key: 'mage-illusionist', characterClass: 'MAGE', unlockLevel: 15 },
    { key: 'mage-elementalist', characterClass: 'MAGE', unlockLevel: 20 },
    { key: 'mage-runekeeper', characterClass: 'MAGE', unlockLevel: 30 },
    { key: 'mage-starcaller', characterClass: 'MAGE', unlockLevel: 40 },
    { key: 'mage-chronomancer', characterClass: 'MAGE', unlockLevel: 50 },
    { key: 'mage-voidseer', characterClass: 'MAGE', unlockLevel: 75 },
  ],
  WARRIOR: [
    { key: 'warrior-recruit', characterClass: 'WARRIOR', unlockLevel: 1 },
    { key: 'warrior-guard', characterClass: 'WARRIOR', unlockLevel: 1 },
    { key: 'warrior-vanguard', characterClass: 'WARRIOR', unlockLevel: 5 },
    { key: 'warrior-champion', characterClass: 'WARRIOR', unlockLevel: 10 },
    { key: 'warrior-berserker', characterClass: 'WARRIOR', unlockLevel: 15 },
    { key: 'warrior-templar', characterClass: 'WARRIOR', unlockLevel: 20 },
    { key: 'warrior-warlord', characterClass: 'WARRIOR', unlockLevel: 30 },
    { key: 'warrior-dreadnought', characterClass: 'WARRIOR', unlockLevel: 40 },
    { key: 'warrior-kingsguard', characterClass: 'WARRIOR', unlockLevel: 50 },
    { key: 'warrior-titan', characterClass: 'WARRIOR', unlockLevel: 75 },
  ],
  ARCHER: [
    { key: 'archer-scout', characterClass: 'ARCHER', unlockLevel: 1 },
    { key: 'archer-hunter', characterClass: 'ARCHER', unlockLevel: 1 },
    { key: 'archer-pathfinder', characterClass: 'ARCHER', unlockLevel: 5 },
    { key: 'archer-ranger', characterClass: 'ARCHER', unlockLevel: 10 },
    { key: 'archer-sharpshooter', characterClass: 'ARCHER', unlockLevel: 15 },
    { key: 'archer-beaststalker', characterClass: 'ARCHER', unlockLevel: 20 },
    { key: 'archer-windrunner', characterClass: 'ARCHER', unlockLevel: 30 },
    { key: 'archer-nightstalker', characterClass: 'ARCHER', unlockLevel: 40 },
    { key: 'archer-warden', characterClass: 'ARCHER', unlockLevel: 50 },
    { key: 'archer-legend', characterClass: 'ARCHER', unlockLevel: 75 },
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
