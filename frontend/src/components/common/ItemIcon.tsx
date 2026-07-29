import { useEffect, useState } from 'react';
import { ITEM_ICON_KEY_SET, itemIconUrl } from './itemIconAssets';

interface ItemIconProps {
  definitionKey: string;
  fallback: string;
  className?: string;
}

export function ItemIcon({ definitionKey, fallback, className = 'h-8 w-8' }: ItemIconProps): React.JSX.Element {
  const [failed, setFailed] = useState(false);

  useEffect(() => setFailed(false), [definitionKey]);

  if (!ITEM_ICON_KEY_SET.has(definitionKey) || failed) {
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
