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

export type TiledLayer = TiledTileLayer | TiledObjectLayer;

export interface TiledTilesetReference {
  firstgid: number;
  source?: string;
  image?: string;
  imagewidth?: number;
  imageheight?: number;
  tilewidth?: number;
  tileheight?: number;
  columns?: number;
  tilecount?: number;
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
  tilesets?: TiledTilesetReference[];
  properties?: TiledProperty[];
}

export interface ClientPortal {
  sourceX: number;
  sourceY: number;
  destinationMapKey: string;
  targetX: number;
  targetY: number;
}

export interface LoadedMapDefinition {
  key: string;
  source: TiledMapJson;
  width: number;
  height: number;
  tileWidth: number;
  tileHeight: number;
  ground: readonly number[];
  collision: Uint8Array;
  portals: readonly ClientPortal[];
}
