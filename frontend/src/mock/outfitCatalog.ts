import type { CharacterClass, CharacterGender } from '../contracts/game';

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
    outfit('mage-scholar', 'Royal Scholar', 'MAGE', 10, 'Ivory court robes with a sunstone focus.'),
    outfit('mage-evoker', 'Evoker Vestments', 'MAGE', 20, 'Crimson battle robes built around destructive magic.'),
    outfit('mage-archmage', 'Archmage Regalia', 'MAGE', 30, 'Violet ceremonial robes trimmed with gold.'),
    outfit('mage-illusionist', 'Illusionist Silks', 'MAGE', 40, 'Layered teal silks and a veiled arcane hood.'),
    outfit('mage-elementalist', 'Elementalist Mantle', 'MAGE', 50, 'A fiery mantle shaped for elemental mastery.'),
    outfit('mage-runekeeper', 'Runekeeper Armor', 'MAGE', 60, 'Runed plate woven into practical battle robes.'),
    outfit('mage-starcaller', 'Starcaller Raiment', 'MAGE', 70, 'Midnight robes patterned after the northern sky.'),
    outfit('mage-chronomancer', 'Chronomancer Garb', 'MAGE', 80, 'Silver clockwork robes with a crystal focus.'),
    outfit('mage-voidseer', 'Voidseer Regalia', 'MAGE', 90, 'Ancient black-gold vestments of the void.'),
    outfit('mage-ascendant', 'Ascendant Vestments', 'MAGE', 100, 'Radiant master robes worn by transcendent magi.'),
  ],
  WARRIOR: [
    outfit('warrior-recruit', 'Recruit Armor', 'WARRIOR', 1, 'Reliable steel armor with a red field sash.'),
    outfit('warrior-guard', 'City Guard', 'WARRIOR', 10, 'Polished blue guard plate with a closed helm.'),
    outfit('warrior-vanguard', 'Vanguard Mail', 'WARRIOR', 20, 'Heavy mail and a crested assault helmet.'),
    outfit('warrior-champion', 'Champion Plate', 'WARRIOR', 30, 'Golden plate and a crimson champion mantle.'),
    outfit('warrior-berserker', 'Berserker Harness', 'WARRIOR', 40, 'Fur-lined armor paired with a round war shield.'),
    outfit('warrior-templar', 'Templar Plate', 'WARRIOR', 50, 'White-gold plate carrying the realm crest.'),
    outfit('warrior-warlord', 'Warlord Armor', 'WARRIOR', 60, 'Dark plate and a commanding scarlet cloak.'),
    outfit('warrior-dreadnought', 'Dreadnought Plate', 'WARRIOR', 70, 'Massive reinforced armor and a tower shield.'),
    outfit('warrior-kingsguard', "King's Guard", 'WARRIOR', 80, 'Ceremonial black-gold armor of the royal guard.'),
    outfit('warrior-titan', 'Titan Armor', 'WARRIOR', 90, 'Mythic violet plate made for battlefield legends.'),
    outfit('warrior-immortal', 'Immortal Aegis', 'WARRIOR', 100, 'Luminous imperial armor with an arcane shield.'),
  ],
  ARCHER: [
    outfit('archer-scout', 'Scout Leathers', 'ARCHER', 1, 'Forest leathers designed for quiet movement.'),
    outfit('archer-hunter', 'Wild Hunter', 'ARCHER', 10, 'Brown-green hunting gear with a weatherproof hood.'),
    outfit('archer-pathfinder', 'Pathfinder Kit', 'ARCHER', 20, 'Light travel armor for long expeditions.'),
    outfit('archer-ranger', 'Ranger Garb', 'ARCHER', 30, 'Dark teal gear worn by veteran pathfinders.'),
    outfit('archer-sharpshooter', 'Sharpshooter Coat', 'ARCHER', 40, 'A fitted coat with reinforced shooting bracers.'),
    outfit('archer-beaststalker', 'Beaststalker Hide', 'ARCHER', 50, 'Layered hide armor made for dangerous hunts.'),
    outfit('archer-windrunner', 'Windrunner Silks', 'ARCHER', 60, 'Light silver-green clothing for unmatched mobility.'),
    outfit('archer-nightstalker', 'Nightstalker Gear', 'ARCHER', 70, 'Blackened leather suited to moonless patrols.'),
    outfit('archer-warden', 'Forest Warden', 'ARCHER', 80, 'Emerald ceremonial armor of the elder wardens.'),
    outfit('archer-legend', 'Legendary Marksman', 'ARCHER', 90, 'Gold-trimmed gear reserved for peerless archers.'),
    outfit('archer-starshot', 'Starshot Regalia', 'ARCHER', 100, 'Violet celestial gear for the realm’s finest archer.'),
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

const OUTFIT_ASSET_VERSION = 23;

const outfitAssetDirectory = (gender: CharacterGender): string =>
  `assets/sprites/${gender === 'FEMALE' ? 'female' : 'male'}`;

export const outfitImageUrl = (
  outfitKey: string,
  gender: CharacterGender = 'MALE',
): string =>
  `${import.meta.env.BASE_URL}${outfitAssetDirectory(gender)}/${encodeURIComponent(outfitKey)}.svg?v=${OUTFIT_ASSET_VERSION}`;

export const outfitImageCandidates = (
  outfitKey: string,
  gender: CharacterGender = 'MALE',
): readonly string[] => [outfitImageUrl(outfitKey, gender)];
