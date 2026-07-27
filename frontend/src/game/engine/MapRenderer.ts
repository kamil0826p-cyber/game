import { Container, Graphics, Sprite, type Texture } from 'pixi.js';
import type { CompiledTileLayer, LoadedMapDefinition } from '../../contracts/tiled';
import { WORLD_TILE_SIZE } from './constants';
import { gameAssetLoader } from './GameAssetLoader';

const TILED_GID_MASK = 0x1fffffff;
const TREE_TRUNK_GID = 3;
const TREE_CANOPY_GID = 4;
const TREE_TRUNK_LAYER_NAME = 'tree trunks';
const TREE_CANOPY_LAYER_NAME = 'tree canopies';
const TREE_TRUNK_WIDTH_TILES = 0.78;
const TREE_TRUNK_HEIGHT_TILES = 2.65;
const TREE_CANOPY_WIDTH_TILES = 3.6;
const TREE_CANOPY_HEIGHT_TILES = 3.4;
const TREE_CANOPY_BOTTOM_ABOVE_BASE_TILES = 0.82;

const normalizedLayerName = (layer: CompiledTileLayer): string => layer.name.trim().toLowerCase();

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
    const trunkLayer = map.layers.find((layer) => normalizedLayerName(layer) === TREE_TRUNK_LAYER_NAME);
    const canopyLayer = map.layers.find((layer) => normalizedLayerName(layer) === TREE_CANOPY_LAYER_NAME);

    for (const layer of map.layers) {
      if (layer === trunkLayer || layer === canopyLayer) continue;
      const container = this.renderTileLayer(map, layer, textures);
      (layer.band === 'above' ? this.aboveContainer : this.belowContainer).addChild(container);
    }

    if (trunkLayer) {
      this.renderTrees(map, trunkLayer, canopyLayer, textures);
    } else if (canopyLayer) {
      this.aboveContainer.addChild(this.renderTileLayer(map, canopyLayer, textures));
    }
  }

  private renderTrees(
    map: LoadedMapDefinition,
    trunkLayer: CompiledTileLayer,
    canopyLayer: CompiledTileLayer | undefined,
    textures?: ReadonlyMap<number, Texture>,
  ): void {
    const trunks = new Container();
    const canopies = new Container();
    const generatedTrunks = new Graphics();
    const generatedCanopies = new Graphics();
    const trunkTexture = textures?.get(TREE_TRUNK_GID);
    const canopyTexture = textures?.get(TREE_CANOPY_GID);

    trunks.label = trunkLayer.name;
    trunks.alpha = trunkLayer.opacity;
    canopies.label = canopyLayer?.name ?? 'Tree Canopies';
    canopies.alpha = canopyLayer?.opacity ?? 1;
    trunks.addChild(generatedTrunks);
    canopies.addChild(generatedCanopies);

    for (let index = 0; index < trunkLayer.data.length; index += 1) {
      const gid = (trunkLayer.data[index] ?? 0) & TILED_GID_MASK;
      if (gid === 0) continue;
      const x = (index % map.width) * WORLD_TILE_SIZE;
      const y = Math.floor(index / map.width) * WORLD_TILE_SIZE;
      const centerX = x + WORLD_TILE_SIZE * 0.5;
      const baseY = y + WORLD_TILE_SIZE;

      generatedTrunks
        .ellipse(centerX, baseY - 2, WORLD_TILE_SIZE * 0.66, WORLD_TILE_SIZE * 0.18)
        .fill({ color: 0x11170f, alpha: 0.42 });

      if (trunkTexture) trunks.addChild(this.createTreeTrunkSprite(trunkTexture, centerX, baseY));
      else this.drawGeneratedTreeTrunk(generatedTrunks, centerX, baseY);

      if (canopyTexture) canopies.addChild(this.createTreeCanopySprite(canopyTexture, centerX, baseY));
      else this.drawGeneratedTreeCanopy(generatedCanopies, centerX, baseY);
    }

    this.belowContainer.addChild(trunks);
    this.aboveContainer.addChild(canopies);
  }

  private createTreeTrunkSprite(texture: Texture, centerX: number, baseY: number): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(centerX, baseY);
    sprite.width = WORLD_TILE_SIZE * TREE_TRUNK_WIDTH_TILES;
    sprite.height = WORLD_TILE_SIZE * TREE_TRUNK_HEIGHT_TILES;
    return sprite;
  }

  private createTreeCanopySprite(texture: Texture, centerX: number, baseY: number): Sprite {
    const sprite = new Sprite(texture);
    sprite.anchor.set(0.5, 1);
    sprite.position.set(centerX, baseY - WORLD_TILE_SIZE * TREE_CANOPY_BOTTOM_ABOVE_BASE_TILES);
    sprite.width = WORLD_TILE_SIZE * TREE_CANOPY_WIDTH_TILES;
    sprite.height = WORLD_TILE_SIZE * TREE_CANOPY_HEIGHT_TILES;
    return sprite;
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
      const sprite = new Sprite(texture);
      sprite.position.set(x, y);
      sprite.width = WORLD_TILE_SIZE;
      sprite.height = WORLD_TILE_SIZE;
      container.addChild(sprite);
    }
    return container;
  }

  private drawGeneratedTreeTrunk(graphics: Graphics, centerX: number, baseY: number): void {
    const size = WORLD_TILE_SIZE;
    graphics
      .roundRect(centerX - size * 0.26, baseY - size * 2.6, size * 0.52, size * 2.58, 7)
      .fill({ color: 0x6b4326 })
      .rect(centerX - size * 0.08, baseY - size * 2.55, size * 0.1, size * 2.42)
      .fill({ color: 0x93603a, alpha: 0.82 });
  }

  private drawGeneratedTreeCanopy(graphics: Graphics, centerX: number, baseY: number): void {
    const size = WORLD_TILE_SIZE;
    const centerY = baseY - size * 2.38;
    graphics
      .ellipse(centerX, centerY, size * 1.48, size * 1.35)
      .fill({ color: 0x1f512c })
      .ellipse(centerX - size * 1.02, centerY + size * 0.08, size * 0.88, size * 0.92)
      .fill({ color: 0x347842 })
      .ellipse(centerX + size * 1.02, centerY - size * 0.12, size * 0.94, size * 0.98)
      .fill({ color: 0x2b6a39 })
      .ellipse(centerX + size * 0.22, centerY + size * 0.86, size * 1.08, size * 0.92)
      .fill({ color: 0x285f34 });
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
