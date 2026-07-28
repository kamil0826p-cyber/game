import { describe, expect, it } from 'vitest';
import { canInteractWithNpc } from '../src/game/npc/npcInteraction';

const self = { mapId: 'map-a', x: 10, y: 10 };
const npc = { mapId: 'map-a', x: 12, y: 8, interactionRadius: 2 };

describe('NPC interaction range', () => {
  it('allows an NPC within Chebyshev interaction radius', () => {
    expect(canInteractWithNpc(self as never, npc as never)).toBe(true);
  });

  it('rejects another map and a distant NPC', () => {
    expect(canInteractWithNpc(self as never, { ...npc, mapId: 'map-b' } as never)).toBe(false);
    expect(canInteractWithNpc(self as never, { ...npc, x: 13 } as never)).toBe(false);
  });
});
