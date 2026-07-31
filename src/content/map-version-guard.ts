import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

interface MapVersionState {
  id: string;
  key: string;
  version: number;
  semanticHash: string;
}

interface MapRow {
  id: string;
  key: string;
  name: string;
  width: number;
  height: number;
  zoneType: string;
  spawnX: number;
  spawnY: number;
  tiledData: unknown;
  version: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

const hashMap = (map: MapRow): string =>
  createHash('sha256')
    .update(
      stableJson({
        key: map.key,
        name: map.name,
        width: map.width,
        height: map.height,
        zoneType: map.zoneType,
        spawnX: map.spawnX,
        spawnY: map.spawnY,
        tiledData: map.tiledData,
      }),
    )
    .digest('hex');

export const captureMapVersions = async (
  client: PoolClient,
): Promise<ReadonlyMap<string, MapVersionState>> => {
  const exists = await client.query<{ exists: boolean }>(
    `SELECT to_regclass('public."Map"') IS NOT NULL AS exists`,
  );
  if (!exists.rows[0]?.exists) return new Map();
  const maps = await client.query<MapRow>(`
    SELECT id, key, name, width, height, "zoneType", "spawnX", "spawnY", "tiledData", version
    FROM "Map"
    ORDER BY key, id
  `);
  return new Map(
    maps.rows.map((map) => [
      map.key,
      {
        id: map.id,
        key: map.key,
        version: map.version,
        semanticHash: hashMap(map),
      },
    ]),
  );
};

export const restoreUnchangedMapVersions = async (
  client: PoolClient,
  before: ReadonlyMap<string, MapVersionState>,
): Promise<number> => {
  if (before.size === 0) return 0;
  const after = await client.query<MapRow>(`
    SELECT id, key, name, width, height, "zoneType", "spawnX", "spawnY", "tiledData", version
    FROM "Map"
    ORDER BY key, id
  `);
  let restored = 0;
  for (const map of after.rows) {
    const previous = before.get(map.key);
    if (!previous || previous.semanticHash !== hashMap(map) || previous.version === map.version) {
      continue;
    }
    const result = await client.query(
      `UPDATE "Map" SET version = $2 WHERE id = $1 AND version = $3`,
      [map.id, previous.version, map.version],
    );
    restored += result.rowCount ?? 0;
  }
  return restored;
};
