import {
  Assets,
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent,
  type Texture,
} from 'pixi.js';
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
  private readonly sprite = new Sprite();
  private readonly fallback: Graphics;
  private destroyed = false;

  constructor(
    readonly mob: MobStatePayload,
    onInteract: (mob: MobStatePayload, point: MobInteractionPoint) => void,
  ) {
    this.container.position.set(
      mob.x * WORLD_TILE_SIZE + WORLD_TILE_SIZE / 2,
      mob.y * WORLD_TILE_SIZE + WORLD_TILE_SIZE / 2,
    );
    this.container.zIndex = mob.y;
    this.container.sortableChildren = true;
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.hitArea = new Rectangle(-24, -38, 48, 62);
    this.container.label = mob.outfitKey;

    const shadow = new Graphics().ellipse(0, 13, 17, 7).fill({ color: 0x000000, alpha: 0.38 });
    shadow.scale.set(Math.max(0.45, mob.renderScale));
    shadow.zIndex = 0;

    this.fallback = this.createFallback();
    this.fallback.scale.set(mob.renderScale);
    this.fallback.position.y = 18 * (1 - mob.renderScale);
    this.fallback.zIndex = 1;

    this.sprite.anchor.set(0.5, 1);
    this.sprite.position.set(0, 18);
    this.sprite.visible = false;
    this.sprite.zIndex = 2;

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
    level.zIndex = 3;

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
    name.zIndex = 3;

    this.container.addChild(shadow, this.fallback, this.sprite, level, name);
    this.container.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    this.container.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      onInteract(mob, { x: event.global.x, y: event.global.y });
    });

    void this.loadSprite();
  }

  destroy(): void {
    this.destroyed = true;
    this.container.destroy({ children: true });
  }

  private async loadSprite(): Promise<void> {
    try {
      const url = `/assets/mobs/${encodeURIComponent(this.mob.outfitKey)}.svg`;
      const texture = await Assets.load<Texture>(url);
      if (this.destroyed) return;

      texture.source.scaleMode = 'nearest';
      this.sprite.texture = texture;
      const maxWidth = 66 * this.mob.renderScale;
      const maxHeight = 58 * this.mob.renderScale;
      const scale = Math.min(
        maxWidth / Math.max(1, texture.width),
        maxHeight / Math.max(1, texture.height),
      );
      this.sprite.scale.set(scale);
      this.sprite.visible = true;
      this.fallback.visible = false;
    } catch {
      // Keep the scaled fallback when the asset cannot be loaded or decoded.
    }
  }

  private createFallback(): Graphics {
    if (this.mob.rank === 'EXECUTIONER') {
      return new Graphics()
        .ellipse(0, 0, 19, 13)
        .fill({ color: 0x8f3039 })
        .circle(-8, -3, 3)
        .circle(8, -3, 3)
        .fill({ color: 0xf2c453 })
        .moveTo(15, -8)
        .bezierCurveTo(27, -20, 31, -7, 23, 1)
        .stroke({ color: 0x7c2630, width: 4 });
    }

    return new Graphics()
      .ellipse(0, 1, 17, 15)
      .fill({ color: 0xd9bd8e })
      .roundRect(-11, -26, 7, 19, 3)
      .roundRect(4, -27, 7, 20, 3)
      .fill({ color: 0xa9875e })
      .circle(-6, -3, 2.5)
      .circle(6, -3, 2.5)
      .fill({ color: 0xb21f2d });
  }
}
