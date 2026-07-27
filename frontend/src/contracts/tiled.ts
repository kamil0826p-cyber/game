export interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}

export interface TiledLayerBase {
  id?: number;
  name: string;
  type: string;
  class?: string;
  visible?: boolean;
  opacity?: number;
  x?: number;
  y?: number;
  offsetx?: number;
  offsety?: number;
  properties?: TiledProperty[];
}

export interface TiledTileLayer extends TiledLayerBase {
  type: 'tilelayer';
  width: number;
  height: number;
  data: number[];
}

export interface TiledObject {
  id?: number;
  name?: string;
  type?: string;
  class?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  point?: boolean;
  properties?: TiledProperty[];
}

export interface TiledObjectLayer extends TiledLayerBase {
  type: 'objectgroup';
  objects: TiledObject[];
}

export interface TiledGroupLayer extends TiledLayerBase {
  type: 'group';
  layers: TiledLayer[];
}

export type TiledLayer = TiledTileLayer | TiledObjectLayer | TiledGroupLayer;

export interface TiledTilesetTile {
  id: number;
  image: string;
  imagewidth?: number;
  imageheight?: number;
}

export interface TiledTilesetReference {
  firstgid: number;
  source?: string;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  tilecount?: number;
  columns?: number;
  margin?: number;
  spacing?: number;
  tiles?: TiledTilesetTile[];
}

export interface TiledTilesetJson {
  type?: 'tileset';
  name?: string;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth: number;
  tileheight: number;
  tilecount: number;
  columns: number;
  margin?: number;
  spacing?: number;
  tiles?: TiledTilesetTile[];
}

export interface TiledMapJson {
  type: 'map';
  orientation: 'orthogonal' | string;
  infinite: boolean;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets: TiledTilesetReference[];
  properties?: TiledProperty[];
}

export interface ClientPortal {
  sourceX: number;
  sourceY: number;
  destinationMapKey: string;
  targetX: number;
  targetY: number;
}

export interface RenderedTileLayer {
  name: string;
  width: number;
  height: number;
  data: readonly number[];
  tileOffsetX: number;
  tileOffsetY: number;
  pixelOffsetX: number;
  pixelOffsetY: number;
  opacity: number;
}

export interface LoadedMapDefinition {
  key: string;
  sourceUrl: string;
  source: TiledMapJson;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  renderLayers: readonly RenderedTileLayer[];
  collision: Uint8Array;
  portals: readonly ClientPortal[];
}
