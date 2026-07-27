import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { LoadedMapDefinition } from '../../contracts/tiled';
import { WORLD_TILE_SIZE } from './constants';
import { gameAssetLoader } from './GameAssetLoader';

const mapPalette: Readonly<
  Record<string, { ground: number; groundAccent: number; wall: number; wallAccent: number }>
> = {
  greenfields: {
    ground: 0x355e38,
    groundAccent: 0x27472e,
    wall: 0x59624f,
    wallAccent: 0x9aab86,
  },
  'crystal-cave': {
    ground: 0x302b45,
    groundAccent: 0x242038,
    wall: 0x4d5270,
    wallAccent: 0x8793c9,
  },
};

export class MapRenderer {
  readonly container = new Container();
  private readonly portalLayer = new Container();
  private readonly portalGraphics: Graphics[] = [];
  private map?: LoadedMapDefinition;
  private loadSequence = 0;
  private destroyed = false;

  constructor() {
    this.container.addChild(this.portalLayer);
  }

  async load(map: LoadedMapDefinition): Promise<boolean> {
    const sequence = ++this.loadSequence;
    const textures = await gameAssetLoader.getTileTextures(map.key);
    if (this.destroyed || sequence !== this.loadSequence) return false;

    this.destroyChildren();
    this.map = map;
    if (textures) this.renderTexturedMap(map, textures);
    else this.renderPrimitiveMap(map);
    this.renderPortals(map);
    return true;
  }

  update(now: number): void {
    const pulse = 0.55 + Math.sin(now / 260) * 0.25;
    for (const portal of this.portalGraphics) {
      portal.alpha = pulse;
      portal.rotation += 0.005;
    }
  }

  get pixelWidth(): number {
    return (this.map?.width ?? 0) * WORLD_TILE_SIZE;
  }

  get pixelHeight(): number {
    return (this.map?.height ?? 0) * WORLD_TILE_SIZE;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadSequence += 1;
    this.destroyChildren();
    this.container.destroy({ children: true });
  }

  private renderTexturedMap(
    map: LoadedMapDefinition,
    textures: ReadonlyMap<number, Texture>,
  ): void {
    const groundLayer = new Container();
    const obstacleLayer = new Container();
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const index = y * map.width + x;
        const groundTexture = textures.get(map.ground[index] ?? 1);
        if (groundTexture) {
          const sprite = new Sprite(groundTexture);
          sprite.position.set(x * WORLD_TILE_SIZE, y * WORLD_TILE_SIZE);
          sprite.width = WORLD_TILE_SIZE;
          sprite.height = WORLD_TILE_SIZE;
          groundLayer.addChild(sprite);
        }

        const obstacleGid = map.obstacles[index] ?? 0;
        if (obstacleGid !== 0) {
          const obstacleTexture = textures.get(obstacleGid);
          if (obstacleTexture) {
            const obstacle = new Sprite(obstacleTexture);
            obstacle.position.set(x * WORLD_TILE_SIZE, y * WORLD_TILE_SIZE);
            obstacle.width = WORLD_TILE_SIZE;
            obstacle.height = WORLD_TILE_SIZE;
            obstacleLayer.addChild(obstacle);
          }
        }
      }
    }
    this.container.addChildAt(groundLayer, 0);
    this.container.addChildAt(obstacleLayer, 1);
  }

  private renderPrimitiveMap(map: LoadedMapDefinition): void {
    const palette = mapPalette[map.key] ?? mapPalette.greenfields!;
    const graphics = new Graphics();
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const left = x * WORLD_TILE_SIZE;
        const top = y * WORLD_TILE_SIZE;
        const checker = (x + y) % 2 === 0;
        graphics
          .rect(left, top, WORLD_TILE_SIZE, WORLD_TILE_SIZE)
          .fill({ color: checker ? palette.ground : palette.groundAccent });
        if (map.collision[y * map.width + x] === 1) {
          graphics
            .roundRect(left + 2, top + 2, WORLD_TILE_SIZE - 4, WORLD_TILE_SIZE - 4, 6)
            .fill({ color: palette.wall })
            .stroke({ color: palette.wallAccent, width: 2, alpha: 0.55 });
        }
      }
    }
    this.container.addChildAt(graphics, 0);
  }

  private renderPortals(map: LoadedMapDefinition): void {
    this.portalLayer.removeChildren();
    this.portalGraphics.length = 0;
    for (const portal of map.portals) {
      const ring = new Graphics()
        .ellipse(0, 0, WORLD_TILE_SIZE * 0.36, WORLD_TILE_SIZE * 0.18)
        .fill({ color: 0x7dd3fc, alpha: 0.18 })
        .stroke({ color: 0xa78bfa, width: 4, alpha: 0.95 });
      ring.position.set(
        (portal.sourceX + 0.5) * WORLD_TILE_SIZE,
        (portal.sourceY + 0.7) * WORLD_TILE_SIZE,
      );
      this.portalLayer.addChild(ring);
      this.portalGraphics.push(ring);
    }
    this.container.addChild(this.portalLayer);
  }

  private destroyChildren(): void {
    const children = this.container.removeChildren();
    for (const child of children) {
      if (child !== this.portalLayer) child.destroy({ children: true });
    }
    this.portalLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.portalGraphics.length = 0;
    if (!this.portalLayer.parent) this.container.addChild(this.portalLayer);
  }
}