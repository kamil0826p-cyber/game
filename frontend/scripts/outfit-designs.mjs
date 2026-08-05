import { ARCHER_OUTFITS } from './outfit-designs/archer.mjs';
import { MAGE_OUTFITS } from './outfit-designs/mage.mjs';
import { WARRIOR_OUTFITS } from './outfit-designs/warrior.mjs';

export const OUTFIT_DESIGNS = [...MAGE_OUTFITS, ...WARRIOR_OUTFITS, ...ARCHER_OUTFITS];
export const OUTFIT_DESIGN_MAP = Object.fromEntries(
  OUTFIT_DESIGNS.map((design) => [design.key, design]),
);
export const OUTFIT_GENDERS = ['MALE', 'FEMALE'];
