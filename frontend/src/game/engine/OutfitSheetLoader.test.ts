import { describe, expect, it } from 'vitest';
import { extractEmbeddedPng } from './OutfitSheetLoader';

describe('outfit sheet decoding', () => {
  it('extracts embedded PNG bytes from committed SVG outfit files', () => {
    const svg = '<svg><image href="data:image/png;base64,iVBORw0KGgo="/></svg>';
    const bytes = extractEmbeddedPng(svg);

    expect(bytes).toBeDefined();
    expect(Array.from(bytes ?? []).slice(0, 8)).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it('rejects SVG files without an embedded PNG sheet', () => {
    expect(extractEmbeddedPng('<svg><rect width="1" height="1"/></svg>')).toBeUndefined();
  });
});
