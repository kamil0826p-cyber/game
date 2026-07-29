import { describe, expect, it } from 'vitest';
import { ITEM_ICON_KEYS, itemIconUrl } from './ItemIcon';

describe('item icon assets', () => {
  it('gives every known item its own replaceable physical file path', () => {
    const paths = ITEM_ICON_KEYS.map(itemIconUrl);

    expect(ITEM_ICON_KEYS).toHaveLength(11);
    expect(new Set(ITEM_ICON_KEYS).size).toBe(11);
    expect(new Set(paths).size).toBe(11);
    expect(paths.every((path) => path.startsWith('/assets/items/'))).toBe(true);
    expect(paths.every((path) => path.endsWith('.svg?v=2'))).toBe(true);
  });

  it('encodes item keys before constructing an asset URL', () => {
    expect(itemIconUrl('future item')).toBe('/assets/items/future%20item.svg?v=2');
  });
});
