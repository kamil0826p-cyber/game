import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { CompiledTileLayer, CompiledTileRenderDefinition, LoadedMapDefinition } from '../../contracts/tiled';
import {
  normalizedGid,
  TILED_FLIPPED_DIAGONALLY_FLAG,
  TILED_FLIPPED_HORIZONTALLY_FLAG,
  TILED_FLIPPED_VERTICALLY_FLAG,
} from '../map/tiledMap';
import { WORLD_TILE_SIZE } from './constants';
import { gameAssetLoader } from './GameAssetLoader';

const DEFAULT_RENDER_DEFINITION: CompiledTileRenderDefinition = {
  widthTiles: 1,
  heightTiles: 1,
  anchorX: 0,
  anchorY: 1,
  offsetXTiles: 0,
  offsetYTiles: 1,
};

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
    const textures = await gameAssetLoader.getTileTextures(map);
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
    container.label = layer.name;
    container.alpha = layer.opacity;
    const scaleX = WORLD_TILE_SIZE / map.tileWidth;
    const scaleY = WORLD_TILE_SIZE / map.tileHeight;
    container.position.set(layer.offsetX * scaleX, layer.offsetY * scaleY);

    for (const index of this.tileIndexes(layer, map.source.renderorder)) {
      const rawGid = layer.data[index] ?? 0;
      const gid = normalizedGid(rawGid);
      if (gid === 0) continue;
      const x = (index % layer.width) * WORLD_TILE_SIZE;
      const y = Math.floor(index / layer.width) * WORLD_TILE_SIZE;
      const renderDefinition = map.tileRenderDefinitions.get(gid) ?? DEFAULT_RENDER_DEFINITION;
      const texture = textures?.get(gid);
      if (!texture) {
        container.addChild(this.createMissingTile(gid, x, y, renderDefinition));
        continue;
      }
      container.addChild(this.createTileSprite(texture, rawGid, x, y, renderDefinition));
    }
    return container;
  }

  private tileIndexes(layer: CompiledTileLayer, renderOrder: string | undefined): number[] {
    const xValues = Array.from({ length: layer.width }, (_, index) => index);
    const yValues = Array.from({ length: layer.height }, (_, index) => index);
    if (renderOrder?.startsWith('left-')) xValues.reverse();
    if (renderOrder?.endsWith('-up')) yValues.reverse();
    return yValues.flatMap((y) => xValues.map((x) => y * layer.width + x));
  }

  private createTileSprite(texture: Texture, rawGid: number, x: number, y: number, definition: CompiledTileRenderDefinition): Sprite {
    const width = WORLD_TILE_SIZE * definition.widthTiles;
    const height = WORLD_TILE_SIZE * definition.heightTiles;
    const left = x + WORLD_TILE_SIZE * definition.offsetXTiles - width * definition.anchorX;
    const top = y + WORLD_TILE_SIZE * definition.offsetYTiles - height * definition.anchorY;
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.position.set(left + width / 2, top + height / 2);
    sprite.width = width;
    sprite.height = height;
    this.applyTiledTransform(sprite, rawGid);
    return sprite;
  }

  private applyTiledTransform(sprite: Sprite, rawGid: number): void {
    const horizontal = (rawGid & TILED_FLIPPED_HORIZONTALLY_FLAG) !== 0;
    const vertical = (rawGid & TILED_FLIPPED_VERTICALLY_FLAG) !== 0;
    const diagonal = (rawGid & TILED_FLIPPED_DIAGONALLY_FLAG) !== 0;
    if (!diagonal) {
      if (horizontal) sprite.scale.x *= -1;
      if (vertical) sprite.scale.y *= -1;
      return;
    }
    if (horizontal && vertical) {
      sprite.rotation = Math.PI / 2;
      sprite.scale.x *= -1;
    } else if (horizontal) {
      sprite.rotation = Math.PI / 2;
    } else if (vertical) {
      sprite.rotation = -Math.PI / 2;
    } else {
      sprite.rotation = Math.PI / 2;
      sprite.scale.y *= -1;
    }
  }

  private createMissingTile(gid: number, x: number, y: number, definition: CompiledTileRenderDefinition): Graphics {
    const width = WORLD_TILE_SIZE * definition.widthTiles;
    const height = WORLD_TILE_SIZE * definition.heightTiles;
    const left = x + WORLD_TILE_SIZE * definition.offsetXTiles - width * definition.anchorX;
    const top = y + WORLD_TILE_SIZE * definition.offsetYTiles - height * definition.anchorY;
    const color = (Math.imul(gid, 2_654_435_761) >>> 8) & 0xffffff;
    return new Graphics()
      .rect(left, top, width, height)
      .fill({ color, alpha: 0.72 })
      .rect(left, top, width, height)
      .stroke({ color: 0xffffff, width: 1, alpha: 0.45 });
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
