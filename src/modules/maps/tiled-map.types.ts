export interface TiledProperty { name: string; type?: string; value: unknown }
export interface TiledPoint { x: number; y: number }
export interface TiledObject { id?: number; name?: string; type?: string; class?: string; x?: number; y?: number; width?: number; height?: number; rotation?: number; gid?: number; visible?: boolean; opacity?: number; ellipse?: boolean; point?: boolean; polygon?: TiledPoint[]; polyline?: TiledPoint[]; properties?: TiledProperty[] }
interface TiledLayerBase { id?: number; name: string; visible?: boolean; opacity?: number; x?: number; y?: number; offsetx?: number; offsety?: number; properties?: TiledProperty[] }
export interface TiledTileLayer extends TiledLayerBase { type: 'tilelayer'; width: number; height: number; data: number[]; encoding?: 'base64' | 'csv'; compression?: 'zlib' | 'gzip' | 'zstd' }
export interface TiledObjectLayer extends TiledLayerBase { type: 'objectgroup'; objects: TiledObject[]; draworder?: 'topdown' | 'index' }
export interface TiledGroupLayer extends TiledLayerBase { type: 'group'; layers: TiledLayer[] }
export type TiledLayer = TiledTileLayer | TiledObjectLayer | TiledGroupLayer;
export interface TiledTileOffset { x: number; y: number }
export interface TiledTileDefinition { id: number; image?: string; imagewidth?: number; imageheight?: number; objectgroup?: TiledObjectLayer; properties?: TiledProperty[] }
export interface TiledTilesetReference { firstgid: number; source?: string; resolvedSourceUrl?: string; name?: string; image?: string; imagewidth?: number; imageheight?: number; tilewidth?: number; tileheight?: number; columns?: number; tilecount?: number; margin?: number; spacing?: number; objectalignment?: string; tileoffset?: TiledTileOffset; tiles?: TiledTileDefinition[] }
export interface TiledMapJson { type: 'map'; orientation?: string; renderorder?: string; infinite?: boolean; width: number; height: number; tilewidth: number; tileheight: number; layers: TiledLayer[]; tilesets?: TiledTilesetReference[]; properties?: TiledProperty[] }
export interface EmbeddedPortalDefinition { sourceX: number; sourceY: number; destinationMapKey: string; targetX: number; targetY: number }
