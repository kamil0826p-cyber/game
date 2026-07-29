interface ItemIconProps {
  definitionKey: string;
  fallback: string;
  className?: string;
}

const knownItemKeys = new Set([
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
]);

export function ItemIcon({ definitionKey, fallback, className = 'h-8 w-8' }: ItemIconProps): React.JSX.Element {
  if (!knownItemKeys.has(definitionKey)) {
    return <span className={className}>{fallback}</span>;
  }

  return (
    <svg
      aria-hidden="true"
      className={`${className} shrink-0 overflow-visible drop-shadow-[0_2px_2px_rgba(0,0,0,0.75)]`}
      viewBox="0 0 64 64"
    >
      <use href={`/assets/items/items.svg#${definitionKey}`} />
    </svg>
  );
}
