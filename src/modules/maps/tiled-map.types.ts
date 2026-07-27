export interface TiledProperty {
  name: string;
  type?: string;
  value: unknown;
}

export interface TiledTileLayer {
  id?: number;
  name: string;
  type: 'tilelayer';
  width: number;
  height: number;
  data: number[];
  encoding?: 'base64';
  compression?: 'zlib' | 'gzip';
  visible?: boolean;
  opacity?: number;
  properties?: TiledProperty[];
}

export interface TiledObject {
  id?: number;
  name?: string;
  type?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  properties?: TiledProperty[];
}

export interface TiledObjectLayer {
  id?: number;
  name: string;
  type: 'objectgroup';
  objects: TiledObject[];
  visible?: boolean;
  opacity?: number;
  properties?: TiledProperty[];
}

export type TiledLayer = TiledTileLayer | TiledObjectLayer | Record<string, unknown>;

export interface TiledTilesetReference {
  firstgid: number;
  source?: string;
  name?: string;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  columns?: number;
  tilecount?: number;
  tiles?: Array<{ id: number; properties?: TiledProperty[] }>;
}

export interface TiledMapJson {
  type: 'map';
  orientation?: string;
  infinite?: boolean;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets?: TiledTilesetReference[];
  properties?: TiledProperty[];
}

export interface EmbeddedPortalDefinition {
  sourceX: number;
  sourceY: number;
  destinationMapKey: string;
  targetX: number;
  targetY: number;
}
