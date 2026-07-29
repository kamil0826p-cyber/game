export const ITEM_ICON_KEYS = [
  'traveler-sword',
  'apprentice-staff',
  'field-bow',
  'minor-health-potion',
  'field-rations',
  'town-scroll',
  'rabbit-fur',
  'rabbit-foot',
  'scorpion-chitin',
  'scorpion-stinger',
  'venom-sac',
] as const;

export const ITEM_ICON_KEY_SET = new Set<string>(ITEM_ICON_KEYS);

export const itemIconUrl = (definitionKey: string): string =>
  `/assets/items/${encodeURIComponent(definitionKey)}.svg?v=2`;
