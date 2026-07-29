import type { CharacterClass } from '../../common/domain/game.types.js';

export interface OutfitDefinition {
  key: string;
  characterClass: CharacterClass;
  unlockLevel: number;
}

export const OUTFIT_CATALOG: Readonly<Record<CharacterClass, readonly OutfitDefinition[]>> = {
  MAGE: [
    { key: 'mage-apprentice', characterClass: 'MAGE', unlockLevel: 1 },
    { key: 'mage-scholar', characterClass: 'MAGE', unlockLevel: 10 },
    { key: 'mage-evoker', characterClass: 'MAGE', unlockLevel: 20 },
    { key: 'mage-archmage', characterClass: 'MAGE', unlockLevel: 30 },
    { key: 'mage-illusionist', characterClass: 'MAGE', unlockLevel: 40 },
    { key: 'mage-elementalist', characterClass: 'MAGE', unlockLevel: 50 },
    { key: 'mage-runekeeper', characterClass: 'MAGE', unlockLevel: 60 },
    { key: 'mage-starcaller', characterClass: 'MAGE', unlockLevel: 70 },
    { key: 'mage-chronomancer', characterClass: 'MAGE', unlockLevel: 80 },
    { key: 'mage-voidseer', characterClass: 'MAGE', unlockLevel: 90 },
    { key: 'mage-ascendant', characterClass: 'MAGE', unlockLevel: 100 },
  ],
  WARRIOR: [
    { key: 'warrior-recruit', characterClass: 'WARRIOR', unlockLevel: 1 },
    { key: 'warrior-guard', characterClass: 'WARRIOR', unlockLevel: 10 },
    { key: 'warrior-vanguard', characterClass: 'WARRIOR', unlockLevel: 20 },
    { key: 'warrior-champion', characterClass: 'WARRIOR', unlockLevel: 30 },
    { key: 'warrior-berserker', characterClass: 'WARRIOR', unlockLevel: 40 },
    { key: 'warrior-templar', characterClass: 'WARRIOR', unlockLevel: 50 },
    { key: 'warrior-warlord', characterClass: 'WARRIOR', unlockLevel: 60 },
    { key: 'warrior-dreadnought', characterClass: 'WARRIOR', unlockLevel: 70 },
    { key: 'warrior-kingsguard', characterClass: 'WARRIOR', unlockLevel: 80 },
    { key: 'warrior-titan', characterClass: 'WARRIOR', unlockLevel: 90 },
    { key: 'warrior-immortal', characterClass: 'WARRIOR', unlockLevel: 100 },
  ],
  ARCHER: [
    { key: 'archer-scout', characterClass: 'ARCHER', unlockLevel: 1 },
    { key: 'archer-hunter', characterClass: 'ARCHER', unlockLevel: 10 },
    { key: 'archer-pathfinder', characterClass: 'ARCHER', unlockLevel: 20 },
    { key: 'archer-ranger', characterClass: 'ARCHER', unlockLevel: 30 },
    { key: 'archer-sharpshooter', characterClass: 'ARCHER', unlockLevel: 40 },
    { key: 'archer-beaststalker', characterClass: 'ARCHER', unlockLevel: 50 },
    { key: 'archer-windrunner', characterClass: 'ARCHER', unlockLevel: 60 },
    { key: 'archer-nightstalker', characterClass: 'ARCHER', unlockLevel: 70 },
    { key: 'archer-warden', characterClass: 'ARCHER', unlockLevel: 80 },
    { key: 'archer-legend', characterClass: 'ARCHER', unlockLevel: 90 },
    { key: 'archer-starshot', characterClass: 'ARCHER', unlockLevel: 100 },
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
