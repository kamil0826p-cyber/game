import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { CompiledTileLayer, LoadedMapDefinition } from '../../contracts/tiled';
import { WORLD_TILE_SIZE } from './constants';
import { gameAssetLoader } from './GameAssetLoader';

export class MapRenderer {
  readonly belowEntities = new Container();
  readonly aboveEntities = new Container();
  private readonly portalLayer = new Container();
  private readonly portalGraphics: Graphics[] = [];
  private map?: LoadedMapDefinition;
  private loadSequence = 0;
  private destroyed = false;

  constructor() {
    this.belowEntities.sortableChildren = true;
    this.aboveEntities.sortableChildren = true;
    this.portalLayer.zIndex = 10_000;
    this.belowEntities.addChild(this.portalLayer);
  }

  async load(map: LoadedMapDefinition): Promise<boolean> {
    const sequence = ++this.loadSequence;
    const textures = await gameAssetLoader.getMapTileTextures(map.source, map.key);
    if (this.destroyed || sequence !== this.loadSequence) return false;
    this.destroyChildren();
    this.map = map;
    map.renderLayers.forEach((layer, index) => this.renderLayer(map, layer, textures, index));
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

  get pixelWidth(): number { return (this.map?.width ?? 0) * WORLD_TILE_SIZE; }
  get pixelHeight(): number { return (this.map?.height ?? 0) * WORLD_TILE_SIZE; }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.loadSequence += 1;
    this.destroyChildren();
    this.belowEntities.destroy({ children: true });
    this.aboveEntities.destroy({ children: true });
  }

  private renderLayer(
    map: LoadedMapDefinition,
    layer: CompiledTileLayer,
    textures: ReadonlyMap<number, Texture>,
    order: number,
  ): void {
    const target = layer.plane === 'above-entities' ? this.aboveEntities : this.belowEntities;
    const container = new Container();
    container.label = layer.name;
    container.alpha = layer.opacity;
    container.position.set(
      (layer.offsetX / map.tileWidth) * WORLD_TILE_SIZE,
      (layer.offsetY / map.tileHeight) * WORLD_TILE_SIZE,
    );
    container.zIndex = order;

    for (let index = 0; index < layer.data.length; index += 1) {
      const gid = layer.data[index] ?? 0;
      if (gid === 0) continue;
      const x = index % map.width;
      const y = Math.floor(index / map.width);
      const texture = textures.get(gid);
      if (texture) {
        const sprite = new Sprite(texture);
        sprite.position.set(x * WORLD_TILE_SIZE, y * WORLD_TILE_SIZE);
        sprite.width = WORLD_TILE_SIZE;
        sprite.height = WORLD_TILE_SIZE;
        container.addChild(sprite);
      } else {
        const hue = (gid * 2654435761) & 0xffffff;
        const fallback = new Graphics()
          .rect(x * WORLD_TILE_SIZE, y * WORLD_TILE_SIZE, WORLD_TILE_SIZE, WORLD_TILE_SIZE)
          .fill({ color: hue, alpha: 0.45 });
        container.addChild(fallback);
      }
    }
    target.addChild(container);
  }

  private renderPortals(map: LoadedMapDefinition): void {
    this.portalLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.portalGraphics.length = 0;
    for (const portal of map.portals) {
      const ring = new Graphics()
        .ellipse(0, 0, WORLD_TILE_SIZE * 0.36, WORLD_TILE_SIZE * 0.18)
        .fill({ color: 0x7dd3fc, alpha: 0.18 })
        .stroke({ color: 0xa78bfa, width: 4, alpha: 0.95 });
      ring.position.set((portal.sourceX + 0.5) * WORLD_TILE_SIZE, (portal.sourceY + 0.7) * WORLD_TILE_SIZE);
      this.portalLayer.addChild(ring);
      this.portalGraphics.push(ring);
    }
    if (!this.portalLayer.parent) this.belowEntities.addChild(this.portalLayer);
  }

  private destroyChildren(): void {
    for (const root of [this.belowEntities, this.aboveEntities]) {
      root.removeChildren().forEach((child) => {
        if (child !== this.portalLayer) child.destroy({ children: true });
      });
    }
    this.portalLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.portalGraphics.length = 0;
    if (!this.portalLayer.parent) this.belowEntities.addChild(this.portalLayer);
  }
}
