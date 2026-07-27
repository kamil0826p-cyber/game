import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { LoadedMapDefinition, RenderedTileLayer } from '../../contracts/tiled';
import { WORLD_TILE_SIZE } from './constants';
import { gameAssetLoader } from './GameAssetLoader';

const HORIZONTAL_FLIP = 0x80000000;
const VERTICAL_FLIP = 0x40000000;
const DIAGONAL_FLIP = 0x20000000;
const GID_MASK = 0x0fffffff;

const tileGid = (rawGid: number): number => (rawGid >>> 0) & GID_MASK;

const applyTileTransform = (sprite: Sprite, rawGid: number): void => {
  const unsignedGid = rawGid >>> 0;
  const horizontal = (unsignedGid & HORIZONTAL_FLIP) !== 0;
  const vertical = (unsignedGid & VERTICAL_FLIP) !== 0;
  const diagonal = (unsignedGid & DIAGONAL_FLIP) !== 0;
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
};

const assertTextureCoverage = (
  map: LoadedMapDefinition,
  textures: ReadonlyMap<number, Texture>,
): void => {
  const missing = new Set<number>();
  for (const layer of map.renderLayers) {
    for (const rawGid of layer.data) {
      const gid = tileGid(rawGid);
      if (gid !== 0 && !textures.has(gid)) missing.add(gid);
    }
  }
  if (missing.size > 0) {
    throw new Error(
      `Map ${map.key} references tile GIDs without graphics: ${[...missing].sort((a, b) => a - b).join(', ')}.`,
    );
  }
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
    const textures = await gameAssetLoader.getTileTextures(map);
    if (this.destroyed || sequence !== this.loadSequence) return false;
    assertTextureCoverage(map, textures);
    this.destroyChildren();
    this.map = map;
    this.renderTexturedMap(map, textures);
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

  private renderTexturedMap(map: LoadedMapDefinition, textures: ReadonlyMap<number, Texture>): void {
    for (const layer of map.renderLayers) {
      this.container.addChildAt(
        this.renderTileLayer(map, layer, textures),
        this.container.children.length - 1,
      );
    }
  }

  private renderTileLayer(
    map: LoadedMapDefinition,
    layer: RenderedTileLayer,
    textures: ReadonlyMap<number, Texture>,
  ): Container {
    const layerContainer = new Container();
    layerContainer.alpha = layer.opacity;
    const pixelScaleX = WORLD_TILE_SIZE / map.tileWidth;
    const pixelScaleY = WORLD_TILE_SIZE / map.tileHeight;
    const layerPixelOffsetX = layer.pixelOffsetX * pixelScaleX;
    const layerPixelOffsetY = layer.pixelOffsetY * pixelScaleY;

    for (let localY = 0; localY < layer.height; localY += 1) {
      for (let localX = 0; localX < layer.width; localX += 1) {
        const rawGid = layer.data[localY * layer.width + localX] ?? 0;
        if (rawGid === 0) continue;
        const texture = textures.get(tileGid(rawGid));
        if (!texture) continue;

        const sprite = new Sprite(texture);
        // Tiled aligns collection-of-images tiles by their bottom edge. Keeping the
        // source image dimensions allows tall scenery such as trees and buildings
        // to extend above the single collision tile at their base.
        sprite.anchor.set(0.5, 1);
        sprite.position.set(
          (layer.tileOffsetX + localX + 0.5) * WORLD_TILE_SIZE + layerPixelOffsetX,
          (layer.tileOffsetY + localY + 1) * WORLD_TILE_SIZE + layerPixelOffsetY,
        );
        sprite.scale.set(pixelScaleX, pixelScaleY);
        applyTileTransform(sprite, rawGid);
        layerContainer.addChild(sprite);
      }
    }
    return layerContainer;
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
