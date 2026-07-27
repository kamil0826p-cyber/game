import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { CompiledTileLayer, LoadedMapDefinition } from '../../contracts/tiled';
import { WORLD_TILE_SIZE } from './constants';
import { gameAssetLoader } from './GameAssetLoader';

export class MapRenderer {
  readonly belowContainer = new Container();
  readonly aboveContainer = new Container();
  private readonly portalLayer = new Container();
  private readonly portalGraphics: Graphics[] = [];
  private map?: LoadedMapDefinition;
  private loadSequence = 0;
  private destroyed = false;

  constructor() {
    this.belowContainer.addChild(this.portalLayer);
  }

  async load(map: LoadedMapDefinition): Promise<boolean> {
    const sequence = ++this.loadSequence;
    const textures = await gameAssetLoader.getTileTextures(map.key);
    if (this.destroyed || sequence !== this.loadSequence) return false;
    this.destroyChildren();
    this.map = map;
    if (textures) this.renderLayers(map, textures);
    else this.renderFallback(map);
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
    this.belowContainer.destroy({ children: true });
    this.aboveContainer.destroy({ children: true });
  }

  private renderLayers(map: LoadedMapDefinition, textures: ReadonlyMap<number, Texture>): void {
    for (const layer of map.layers) {
      const container = this.renderTileLayer(map, layer, textures);
      (layer.band === 'above' ? this.aboveContainer : this.belowContainer).addChild(container);
    }
  }

  private renderTileLayer(map: LoadedMapDefinition, layer: CompiledTileLayer, textures: ReadonlyMap<number, Texture>): Container {
    const container = new Container();
    container.label = layer.name;
    container.alpha = layer.opacity;
    for (let index = 0; index < layer.data.length; index += 1) {
      const gid = layer.data[index] ?? 0;
      if (gid === 0) continue;
      const texture = textures.get(gid);
      if (!texture) continue;
      const sprite = new Sprite(texture);
      sprite.position.set((index % map.width) * WORLD_TILE_SIZE, Math.floor(index / map.width) * WORLD_TILE_SIZE);
      sprite.width = WORLD_TILE_SIZE;
      sprite.height = WORLD_TILE_SIZE;
      container.addChild(sprite);
    }
    return container;
  }

  private renderFallback(map: LoadedMapDefinition): void {
    const graphics = new Graphics();
    for (let y = 0; y < map.height; y += 1) for (let x = 0; x < map.width; x += 1) graphics.rect(x * WORLD_TILE_SIZE, y * WORLD_TILE_SIZE, WORLD_TILE_SIZE, WORLD_TILE_SIZE).fill({ color: (x + y) % 2 === 0 ? 0x355e38 : 0x2d5232 });
    this.belowContainer.addChildAt(graphics, 0);
  }

  private renderPortals(map: LoadedMapDefinition): void {
    for (const portal of map.portals) {
      const ring = new Graphics().ellipse(0, 0, WORLD_TILE_SIZE * 0.36, WORLD_TILE_SIZE * 0.18).fill({ color: 0x7dd3fc, alpha: 0.18 }).stroke({ color: 0xa78bfa, width: 4, alpha: 0.95 });
      ring.position.set((portal.sourceX + 0.5) * WORLD_TILE_SIZE, (portal.sourceY + 0.7) * WORLD_TILE_SIZE);
      this.portalLayer.addChild(ring);
      this.portalGraphics.push(ring);
    }
    this.belowContainer.addChild(this.portalLayer);
  }

  private destroyChildren(): void {
    for (const parent of [this.belowContainer, this.aboveContainer]) for (const child of parent.removeChildren()) if (child !== this.portalLayer) child.destroy({ children: true });
    this.portalLayer.removeChildren().forEach((child) => child.destroy({ children: true }));
    this.portalGraphics.length = 0;
    if (!this.portalLayer.parent) this.belowContainer.addChild(this.portalLayer);
  }
}
