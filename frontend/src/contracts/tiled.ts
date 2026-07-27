export interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}

export interface TiledChunk {
  x: number;
  y: number;
  width: number;
  height: number;
  data: number[];
}

interface TiledLayerBase {
  id?: number;
  name: string;
  visible?: boolean;
  opacity?: number;
  offsetx?: number;
  offsety?: number;
  properties?: TiledProperty[];
}

export interface TiledTileLayer extends TiledLayerBase {
  type: 'tilelayer';
  width?: number;
  height?: number;
  data?: number[];
  chunks?: TiledChunk[];
  x?: number;
  y?: number;
}

export interface TiledPoint {
  x: number;
  y: number;
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
  rotation?: number;
  visible?: boolean;
  point?: boolean;
  ellipse?: boolean;
  polygon?: TiledPoint[];
  polyline?: TiledPoint[];
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

export interface TiledTileDefinition {
  id: number;
  properties?: TiledProperty[];
}

export interface TiledTilesetReference {
  firstgid: number;
  source?: string;
  name?: string;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  tileoffset?: { x: number; y: number };
  columns?: number;
  tilecount?: number;
  spacing?: number;
  margin?: number;
  tiles?: TiledTileDefinition[];
}

export interface TiledMapJson {
  type: 'map';
  orientation: 'orthogonal';
  renderorder?: 'right-down' | 'right-up' | 'left-down' | 'left-up';
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

export type MapRenderPlane = 'below-entities' | 'above-entities';

export interface CompiledTileLayer {
  id: number;
  name: string;
  plane: MapRenderPlane;
  opacity: number;
  offsetX: number;
  offsetY: number;
  data: readonly number[];
}

export interface LoadedMapDefinition {
  key: string;
  source: TiledMapJson;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  renderLayers: readonly CompiledTileLayer[];
  collision: Uint8Array;
  portals: readonly ClientPortal[];
}
