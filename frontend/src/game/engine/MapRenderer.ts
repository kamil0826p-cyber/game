import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { CompiledTileLayer, LoadedMapDefinition } from '../../contracts/tiled';
import { WORLD_TILE_SIZE } from './constants';
import { gameAssetLoader } from './GameAssetLoader';

const TILED_GID_MASK = 0x1fffffff;
const TREE_TRUNK_GID = 3;
const TREE_CANOPY_GID = 4;

export class MapRenderer {
  readonly belowContainer = new Container();
  readonly container = this.belowContainer;
  readonly aboveContainer = new Container();
  private readonly portalLayer = new Container();
  private readonly portalGraphics: Graphics[] = [];
  private map?: LoadedMapDefinition;
  private loadSequence = 0;
  private destroyed = false;

  constructor() {
    this.belowContainer.zIndex = 0;
    this.aboveContainer.zIndex = 3;
    this.belowContainer.addChild(this.portalLayer);
  }

  async load(map: LoadedMapDefinition): Promise<boolean> {
    const sequence = ++this.loadSequence;
    const textures = await gameAssetLoader.getTileTextures(map.key);
    if (this.destroyed || sequence !== this.loadSequence) return false;
    this.destroyChildren();
    this.map = map;
    this.renderLayers(map, textures);
    this.renderPortals(map);
    const world = this.belowContainer.parent;
    if (world && this.aboveContainer.parent !== world) world.addChild(this.aboveContainer);
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
    this.aboveContainer.removeFromParent();
    this.belowContainer.destroy({ children: true });
    this.aboveContainer.destroy({ children: true });
  }

  private renderLayers(map: LoadedMapDefinition, textures?: ReadonlyMap<number, Texture>): void {
    for (const layer of map.layers) {
      const container = this.renderTileLayer(map, layer, textures);
      (layer.band === 'above' ? this.aboveContainer : this.belowContainer).addChild(container);
    }
  }

  private renderTileLayer(map: LoadedMapDefinition, layer: CompiledTileLayer, textures?: ReadonlyMap<number, Texture>): Container {
    const container = new Container();
    const generated = new Graphics();
    container.label = layer.name;
    container.alpha = layer.opacity;
    container.addChild(generated);

    for (let index = 0; index < layer.data.length; index += 1) {
      const gid = (layer.data[index] ?? 0) & TILED_GID_MASK;
      if (gid === 0) continue;
      const x = (index % map.width) * WORLD_TILE_SIZE;
      const y = Math.floor(index / map.width) * WORLD_TILE_SIZE;
      const texture = textures?.get(gid);
      if (!texture) {
        this.drawGeneratedTile(generated, gid, x, y, index);
        continue;
      }
      container.addChild(this.createTileSprite(texture, gid, x, y));
    }
    return container;
  }

  private createTileSprite(texture: Texture, gid: number, x: number, y: number): Sprite {
    const sprite = new Sprite(texture);

    if (gid === TREE_TRUNK_GID) {
      sprite.anchor.set(0.5, 1);
      sprite.position.set(x + WORLD_TILE_SIZE * 0.5, y + WORLD_TILE_SIZE);
      sprite.width = WORLD_TILE_SIZE * 1.15;
      sprite.height = WORLD_TILE_SIZE * 1.35;
      return sprite;
    }

    if (gid === TREE_CANOPY_GID) {
      sprite.anchor.set(0.5, 1);
      sprite.position.set(x + WORLD_TILE_SIZE * 0.5, y + WORLD_TILE_SIZE * 1.35);
      sprite.width = WORLD_TILE_SIZE * 1.75;
      sprite.height = WORLD_TILE_SIZE * 1.6;
      return sprite;
    }

    sprite.position.set(x, y);
    sprite.width = WORLD_TILE_SIZE;
    sprite.height = WORLD_TILE_SIZE;
    return sprite;
  }

  private drawGeneratedTile(graphics: Graphics, gid: number, x: number, y: number, index: number): void {
    const size = WORLD_TILE_SIZE;
    if (gid === 1) {
      const color = index % 2 === 0 ? 0x315f39 : 0x2c5735;
      graphics.rect(x, y, size, size).fill({ color });
      graphics.rect(x, y, size, size).stroke({ color: 0x47784d, width: 1, alpha: 0.22 });
      if (index % 7 === 0) graphics.circle(x + 12, y + 15, 2).fill({ color: 0x5f8c55, alpha: 0.65 });
      return;
    }
    if (gid === 2) {
      graphics.rect(x, y, size, size).fill({ color: 0x9a7648 });
      graphics.rect(x, y + size * 0.18, size, size * 0.64).fill({ color: 0xb48d57 });
      graphics.rect(x, y, size, size).stroke({ color: 0xd0ad72, width: 1, alpha: 0.28 });
      return;
    }
    if (gid === TREE_TRUNK_GID) {
      graphics.ellipse(x + size * 0.5, y + size * 0.94, size * 0.28, size * 0.1).fill({ color: 0x11170f, alpha: 0.35 });
      graphics.roundRect(x + size * 0.36, y - size * 0.35, size * 0.28, size * 1.3, 4).fill({ color: 0x6b4326 });
      graphics.rect(x + size * 0.45, y - size * 0.31, size * 0.06, size * 1.2).fill({ color: 0x93603a, alpha: 0.8 });
      return;
    }
    if (gid === TREE_CANOPY_GID) {
      graphics.circle(x + size * 0.5, y + size * 0.48, size * 0.58).fill({ color: 0x1f512c });
      graphics.circle(x + size * 0.2, y + size * 0.42, size * 0.38).fill({ color: 0x347842 });
      graphics.circle(x + size * 0.8, y + size * 0.36, size * 0.4).fill({ color: 0x2b6a39 });
      graphics.circle(x + size * 0.56, y + size * 0.75, size * 0.42).fill({ color: 0x285f34 });
      graphics.rect(x + size * 0.42, y + size * 0.72, size * 0.16, size * 0.28).fill({ color: 0x6b4326 });
      return;
    }
    if (gid === 5) {
      const color = index % 2 === 0 ? 0x29263b : 0x252235;
      graphics.rect(x, y, size, size).fill({ color });
      graphics.rect(x, y, size, size).stroke({ color: 0x403b59, width: 1, alpha: 0.3 });
      if (index % 9 === 0) graphics.circle(x + 31, y + 12, 2).fill({ color: 0x8d8bd1, alpha: 0.45 });
      return;
    }
    if (gid === 6) {
      graphics.ellipse(x + size * 0.5, y + size * 0.87, size * 0.34, size * 0.1).fill({ color: 0x11111b, alpha: 0.45 });
      graphics.roundRect(x + size * 0.16, y + size * 0.25, size * 0.68, size * 0.58, 8).fill({ color: 0x5f6689 });
      graphics.roundRect(x + size * 0.29, y + size * 0.2, size * 0.31, size * 0.38, 6).fill({ color: 0x949de0, alpha: 0.78 });
      graphics.circle(x + size * 0.67, y + size * 0.42, size * 0.09).fill({ color: 0xc4c9ff, alpha: 0.75 });
    }
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
