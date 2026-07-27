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

export interface TiledTileLayer {
  id?: number;
  name: string;
  type: 'tilelayer';
  width?: number;
  height?: number;
  data?: number[];
  chunks?: TiledChunk[];
  x?: number;
  y?: number;
  offsetx?: number;
  offsety?: number;
  visible?: boolean;
  opacity?: number;
  properties?: TiledProperty[];
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
  ellipse?: boolean;
  polygon?: Array<{ x: number; y: number }>;
  polyline?: Array<{ x: number; y: number }>;
  properties?: TiledProperty[];
}

export interface TiledObjectLayer {
  id?: number;
  name: string;
  type: 'objectgroup';
  objects: TiledObject[];
  offsetx?: number;
  offsety?: number;
  visible?: boolean;
  opacity?: number;
  properties?: TiledProperty[];
}

export interface TiledGroupLayer {
  id?: number;
  name: string;
  type: 'group';
  layers: TiledLayer[];
  offsetx?: number;
  offsety?: number;
  visible?: boolean;
  opacity?: number;
  properties?: TiledProperty[];
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
  renderorder?: string;
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
