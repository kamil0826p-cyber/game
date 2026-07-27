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

export interface EmbeddedPortalDefinition {
  sourceX: number;
  sourceY: number;
  destinationMapKey: string;
  targetX: number;
  targetY: number;
}

export interface TiledPointDefinition {
  x: number;
  y: number;
}

export interface TiledMapMetadata {
  key: string;
  name: string;
  zoneType: 'SAFE' | 'OUTLAW' | 'PVP';
  spawnX: number;
  spawnY: number;
  isDefault: boolean;
}
