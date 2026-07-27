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
  offsetx?: number;
  offsety?: number;
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
  properties?: TiledProperty[];
}

export interface TiledObjectLayer {
  id?: number;
  name: string;
  type: 'objectgroup';
  objects: TiledObject[];
  offsetx?: number;
  offsety?: number;
  properties?: TiledProperty[];
}

export interface TiledGroupLayer {
  id?: number;
  name: string;
  type: 'group';
  layers: TiledLayer[];
  offsetx?: number;
  offsety?: number;
  properties?: TiledProperty[];
}

export type TiledLayer = TiledTileLayer | TiledObjectLayer | TiledGroupLayer;

export interface TiledMapJson {
  type: 'map';
  orientation?: string;
  infinite?: boolean;
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  tilesets?: unknown[];
  properties?: TiledProperty[];
}

export interface EmbeddedPortalDefinition {
  sourceX: number;
  sourceY: number;
  destinationMapKey: string;
  targetX: number;
  targetY: number;
}
