import { Container, Graphics, Text } from 'pixi.js';
import type { NpcDefinition } from '../npc/npcCatalog';
import { WORLD_TILE_SIZE } from './constants';

export class NpcView {
  readonly container = new Container();

  constructor(readonly npc: NpcDefinition, onInteract: (npc: NpcDefinition) => void) {
    this.container.position.set(
      npc.x * WORLD_TILE_SIZE + WORLD_TILE_SIZE / 2,
      npc.y * WORLD_TILE_SIZE + WORLD_TILE_SIZE / 2,
    );
    this.container.zIndex = npc.y;
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.hitArea = { contains: (x: number, y: number) => x >= -18 && x <= 18 && y >= -30 && y <= 20 };

    const shadow = new Graphics().ellipse(0, 13, 14, 6).fill({ color: 0x000000, alpha: 0.35 });
    const body = new Graphics()
      .rect(-9, -8, 18, 21).fill({ color: 0x7c2d12 })
      .rect(-7, -5, 14, 8).fill({ color: 0xb45309 })
      .rect(-8, 8, 6, 10).fill({ color: 0x1f2937 })
      .rect(2, 8, 6, 10).fill({ color: 0x1f2937 });
    const head = new Graphics()
      .rect(-7, -20, 14, 13).fill({ color: 0xd6a56f })
      .rect(-9, -24, 18, 7).fill({ color: 0x9ca3af })
      .rect(-10, -21, 4, 11).fill({ color: 0x6b7280 })
      .rect(6, -21, 4, 11).fill({ color: 0x6b7280 });
    const shield = new Graphics()
      .roundRect(-17, -8, 10, 18, 3).fill({ color: 0x78350f })
      .rect(-13, -5, 2, 12).fill({ color: 0xf59e0b });
    const sword = new Graphics()
      .rect(12, -14, 2, 23).fill({ color: 0xd1d5db })
      .rect(9, 5, 8, 2).fill({ color: 0xfbbf24 })
      .rect(12, 7, 2, 7).fill({ color: 0x78350f });
    const tradeMarker = new Text({ text: '¤', style: { fill: 0xfbbf24, fontSize: 16, fontWeight: 'bold', stroke: { color: 0x451a03, width: 3 } } });
    tradeMarker.anchor.set(0.5);
    tradeMarker.position.set(0, -34);
    const name = new Text({ text: npc.name, style: { fill: 0xfef3c7, fontSize: 10, fontWeight: 'bold', stroke: { color: 0x111827, width: 3 } } });
    name.anchor.set(0.5, 0);
    name.position.set(0, 22);

    this.container.addChild(shadow, body, head, shield, sword, tradeMarker, name);
    this.container.on('pointertap', (event) => {
      event.stopPropagation();
      onInteract(npc);
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
