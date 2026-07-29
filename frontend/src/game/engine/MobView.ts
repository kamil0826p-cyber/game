import { Container, Graphics, Rectangle, Sprite, Text, type FederatedPointerEvent } from 'pixi.js';
import type { MobStatePayload } from '../../contracts/mob';
import { WORLD_TILE_SIZE } from './constants';

export interface MobInteractionPoint {
  x: number;
  y: number;
}

const rankLabel: Record<MobStatePayload['rank'], string> = {
  SPAWN: 'Pomiot',
  EXECUTIONER: 'Kat',
  ARCH_EXECUTIONER: 'Arcykat',
  REAPER: 'Żniwiarz',
  ANCIENT: 'Przedwieczny',
};

export class MobView {
  readonly container = new Container();

  constructor(
    readonly mob: MobStatePayload,
    onInteract: (mob: MobStatePayload, point: MobInteractionPoint) => void,
  ) {
    this.container.position.set(
      mob.x * WORLD_TILE_SIZE + WORLD_TILE_SIZE / 2,
      mob.y * WORLD_TILE_SIZE + WORLD_TILE_SIZE / 2,
    );
    this.container.zIndex = mob.y;
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.hitArea = new Rectangle(-24, -38, 48, 62);
    this.container.label = mob.outfitKey;

    const shadow = new Graphics().ellipse(0, 13, 17, 7).fill({ color: 0x000000, alpha: 0.38 });
    const sprite = Sprite.from(`/assets/mobs/${encodeURIComponent(mob.outfitKey)}.svg`);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(0, 18);
    sprite.width = mob.rank === 'EXECUTIONER' ? 66 : 58;
    sprite.height = 58;

    const level = new Text({
      text: `Lv. ${mob.level} · ${rankLabel[mob.rank]}`,
      style: {
        fill: mob.rank === 'SPAWN' ? 0xd9f99d : 0xfca5a5,
        fontSize: 9,
        fontWeight: 'bold',
        stroke: { color: 0x111827, width: 3 },
      },
    });
    level.anchor.set(0.5, 1);
    level.position.set(0, -29);

    const name = new Text({
      text: mob.name,
      style: {
        fill: 0xfef3c7,
        fontSize: 10,
        fontWeight: 'bold',
        stroke: { color: 0x111827, width: 3 },
      },
    });
    name.anchor.set(0.5, 0);
    name.position.set(0, 21);

    this.container.addChild(shadow, sprite, level, name);
    this.container.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    this.container.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      onInteract(mob, { x: event.global.x, y: event.global.y });
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
