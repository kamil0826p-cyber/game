import { useEffect, useState } from 'react';

interface ItemIconProps {
  definitionKey: string;
  fallback: string;
  className?: string;
}

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

const knownItemKeys = new Set<string>(ITEM_ICON_KEYS);

export const itemIconUrl = (definitionKey: string): string =>
  `/assets/items/${encodeURIComponent(definitionKey)}.svg?v=2`;

export function ItemIcon({ definitionKey, fallback, className = 'h-8 w-8' }: ItemIconProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [definitionKey]);

  if (!knownItemKeys.has(definitionKey) || failed) {
    return <span className={`${className} inline-flex items-center justify-center`}>{fallback}</span>;
  }

  return (
    <img
      aria-hidden="true"
      alt=""
      className={`${className} shrink-0 object-contain drop-shadow-[0_2px_2px_rgba(0,0,0,0.75)]`}
      draggable={false}
      src={itemIconUrl(definitionKey)}
      onError={() => setFailed(true)}
    />
  );
}
