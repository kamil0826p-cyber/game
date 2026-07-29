import type { CharacterClass } from '../contracts/game';

export interface ClientOutfitDefinition {
  key: string;
  label: string;
  characterClass: CharacterClass;
  unlockLevel: number;
  description: string;
}

const outfit = (
  key: string,
  label: string,
  characterClass: CharacterClass,
  unlockLevel: number,
  description: string,
): ClientOutfitDefinition => ({ key, label, characterClass, unlockLevel, description });

export const OUTFIT_CATALOG: Readonly<Record<CharacterClass, readonly ClientOutfitDefinition[]>> = {
  MAGE: [
    outfit('mage-apprentice', 'Apprentice Robes', 'MAGE', 1, 'Blue academy robes with a crystal-tipped staff.'),
    outfit('mage-scholar', 'Royal Scholar', 'MAGE', 1, 'Ivory and blue robes worn by court scholars.'),
    outfit('mage-evoker', 'Evoker Vestments', 'MAGE', 5, 'Crimson vestments prepared for destructive magic.'),
    outfit('mage-archmage', 'Archmage Regalia', 'MAGE', 10, 'Violet ceremonial robes trimmed with gold.'),
    outfit('mage-illusionist', 'Illusionist Silks', 'MAGE', 15, 'Layered teal silks that shimmer while moving.'),
    outfit('mage-elementalist', 'Elementalist Mantle', 'MAGE', 20, 'A mantle marked with fire, frost, storm, and stone.'),
    outfit('mage-runekeeper', 'Runekeeper Armor', 'MAGE', 30, 'Battle robes reinforced with engraved rune plates.'),
    outfit('mage-starcaller', 'Starcaller Raiment', 'MAGE', 40, 'Midnight cloth patterned after the northern sky.'),
    outfit('mage-chronomancer', 'Chronomancer Garb', 'MAGE', 50, 'Silver robes built around a clockwork focus.'),
    outfit('mage-voidseer', 'Voidseer Regalia', 'MAGE', 75, 'Ancient black-gold vestments for masters of the void.'),
  ],
  WARRIOR: [
    outfit('warrior-recruit', 'Recruit Armor', 'WARRIOR', 1, 'Reliable steel armor with a red field sash.'),
    outfit('warrior-guard', 'City Guard', 'WARRIOR', 1, 'Polished guard armor with a royal blue tabard.'),
    outfit('warrior-vanguard', 'Vanguard Mail', 'WARRIOR', 5, 'Heavy mail designed for the first line of battle.'),
    outfit('warrior-champion', 'Champion Plate', 'WARRIOR', 10, 'Golden plate and a crimson champion mantle.'),
    outfit('warrior-berserker', 'Berserker Harness', 'WARRIOR', 15, 'Fur-lined armor made for relentless assaults.'),
    outfit('warrior-templar', 'Templar Plate', 'WARRIOR', 20, 'White-gold plate carrying the realm crest.'),
    outfit('warrior-warlord', 'Warlord Armor', 'WARRIOR', 30, 'Dark plate and a commanding scarlet cloak.'),
    outfit('warrior-dreadnought', 'Dreadnought Plate', 'WARRIOR', 40, 'Massive reinforced armor for unstoppable advances.'),
    outfit('warrior-kingsguard', "King's Guard", 'WARRIOR', 50, 'Ceremonial black-gold armor of the royal guard.'),
    outfit('warrior-titan', 'Titan Armor', 'WARRIOR', 75, 'Mythic plate shaped for the greatest battlefield legends.'),
  ],
  ARCHER: [
    outfit('archer-scout', 'Scout Leathers', 'ARCHER', 1, 'Forest leathers designed for quiet movement.'),
    outfit('archer-hunter', 'Wild Hunter', 'ARCHER', 1, 'Brown-green hunting gear with a weatherproof hood.'),
    outfit('archer-pathfinder', 'Pathfinder Kit', 'ARCHER', 5, 'Light travel armor for long expeditions.'),
    outfit('archer-ranger', 'Ranger Garb', 'ARCHER', 10, 'Dark teal gear worn by veteran pathfinders.'),
    outfit('archer-sharpshooter', 'Sharpshooter Coat', 'ARCHER', 15, 'A fitted coat with reinforced shooting bracers.'),
    outfit('archer-beaststalker', 'Beaststalker Hide', 'ARCHER', 20, 'Layered hide armor made for dangerous hunts.'),
    outfit('archer-windrunner', 'Windrunner Silks', 'ARCHER', 30, 'Light silver-green clothing for unmatched mobility.'),
    outfit('archer-nightstalker', 'Nightstalker Gear', 'ARCHER', 40, 'Blackened leather suited to moonless patrols.'),
    outfit('archer-warden', 'Forest Warden', 'ARCHER', 50, 'Emerald ceremonial armor of the elder wardens.'),
    outfit('archer-legend', 'Legendary Marksman', 'ARCHER', 75, 'Gold-trimmed gear reserved for peerless archers.'),
  ],
};

export const CLASS_PRESENTATION: Readonly<
  Record<CharacterClass, { label: string; role: string; description: string; accent: string }>
> = {
  MAGE: { label: 'Mage', role: 'Arcane specialist', description: 'High energy and intelligence with fragile defenses.', accent: 'text-violet-300' },
  WARRIOR: { label: 'Warrior', role: 'Armored vanguard', description: 'High health, strength, and armor for close combat.', accent: 'text-rose-300' },
  ARCHER: { label: 'Archer', role: 'Agile marksman', description: 'High agility with balanced health and energy.', accent: 'text-emerald-300' },
};

export const outfitImageUrl = (outfitKey: string): string =>
  `/assets/sprites/${encodeURIComponent(outfitKey)}.png`;
