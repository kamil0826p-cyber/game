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
  properties?: TiledProperty[];
}

export type TiledLayer = TiledTileLayer | TiledObjectLayer | Record<string, unknown>;

export interface TiledMapJson {
  type: 'map';
  width: number;
  height: number;
  tilewidth: number;
  tileheight: number;
  layers: TiledLayer[];
  properties?: TiledProperty[];
}

export interface EmbeddedPortalDefinition {
  sourceX: number;
  sourceY: number;
  destinationMapKey: string;
  targetX: number;
  targetY: number;
}
