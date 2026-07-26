import { describe, expect, it } from 'vitest';
import type { GameConfigService } from '../src/config/game-config.service.js';
import { SpatialIndexService } from '../src/modules/world/spatial-index.service.js';

const config = {
  values: { SPATIAL_BUCKET_SIZE: 4 },
} as unknown as GameConfigService;

describe('SpatialIndexService', () => {
  it('returns only IDs in buckets intersecting the rectangle', () => {
    const index = new SpatialIndexService(config);
    index.add('near', 'map-a', 2, 2);
    index.add('same-edge-bucket', 'map-a', 3, 3);
    index.add('far', 'map-a', 12, 12);
    index.add('other-map', 'map-b', 2, 2);

    expect([...index.queryRectangle('map-a', 0, 3, 0, 3)].sort()).toEqual([
      'near',
      'same-edge-bucket',
    ]);
  });

  it('moves an ID between map buckets and removes empty buckets', () => {
    const index = new SpatialIndexService(config);
    index.add('player', 'map-a', 1, 1);
    index.move('player', 'map-a', 1, 1, 'map-b', 9, 9);

    expect(index.queryRectangle('map-a', 0, 3, 0, 3).has('player')).toBe(false);
    expect(index.queryRectangle('map-b', 8, 11, 8, 11).has('player')).toBe(true);

    index.remove('player', 'map-b', 9, 9);
    expect(index.queryRectangle('map-b', 8, 11, 8, 11).size).toBe(0);
  });
});
