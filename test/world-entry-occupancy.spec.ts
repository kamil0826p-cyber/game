import { describe, expect, it, vi } from 'vitest';
import { createWorldEntryOccupancyPredicate } from '../src/modules/realtime/world-entry-occupancy.js';

describe('world entry occupancy', () => {
  it('blocks an occupied tile regardless of the map zone type', () => {
    const isOccupied = vi.fn(() => true);
    const predicate = createWorldEntryOccupancyPredicate(
      { isOccupied },
      'greenfields-map-id',
      'entering-character-id',
    );

    expect(predicate(4, 4)).toBe(true);
    expect(isOccupied).toHaveBeenCalledWith(
      'greenfields-map-id',
      4,
      4,
      'entering-character-id',
    );
  });

  it('allows a free tile', () => {
    const predicate = createWorldEntryOccupancyPredicate(
      { isOccupied: () => false },
      'greenfields-map-id',
      'entering-character-id',
    );

    expect(predicate(5, 4)).toBe(false);
  });
});
