import { createHash } from 'node:crypto';
import type {
  CompiledContentPackage,
  ContentCategory,
  ContentLogicalDiff,
  ContentManifest,
  ContentSnapshotRecord,
} from './content.types.js';

const CATEGORY_NAMES: readonly ContentCategory[] = [
  'maps',
  'portals',
  'npcs',
  'quests',
  'mobs',
  'encounters',
  'skills',
  'items',
  'lootTables',
  'recipes',
  'expeditions',
  'modifiers',
];

const objectIdentity = (value: Record<string, unknown>): string | undefined => {
  if (typeof value.category === 'string' && typeof value.key === 'string') {
    return `category:${value.category}:key:${value.key}`;
  }
  if (typeof value.key === 'string') return `key:${value.key}`;
  if (typeof value.id === 'string') return `id:${value.id}`;
  if (
    typeof value.sourceMapKey === 'string' &&
    typeof value.sourceX === 'number' &&
    typeof value.sourceY === 'number'
  ) {
    return `portal:${value.sourceMapKey}:${value.sourceX}:${value.sourceY}`;
  }
  if (typeof value.itemKey === 'string') return `item:${value.itemKey}`;
  if (typeof value.mobKey === 'string') return `mob:${value.mobKey}`;
  if (typeof value.x === 'number' && typeof value.y === 'number') {
    return `coordinate:${value.x}:${value.y}`;
  }
  return undefined;
};

export function canonicalizeContentValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    const canonical = value.map(canonicalizeContentValue);
    const identities = canonical.map((entry) =>
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? objectIdentity(entry as Record<string, unknown>)
        : undefined,
    );
    if (identities.every((identity) => identity !== undefined)) {
      return canonical
        .map((entry, index) => ({ entry, identity: identities[index]! }))
        .sort((left, right) => left.identity.localeCompare(right.identity))
        .map(({ entry }) => entry);
    }
    return canonical;
  }
  if (!value || typeof value !== 'object') return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    if (
      ['databaseId', 'createdAt', 'updatedAt', 'resolvedSourceUrl'].includes(key)
    ) {
      continue;
    }
    const nested = input[key];
    if (nested === undefined) continue;
    output[key] = canonicalizeContentValue(nested);
  }
  return output;
}

export function stableContentJson(value: unknown): string {
  return JSON.stringify(canonicalizeContentValue(value));
}

export function stableContentHash(value: unknown): string {
  return createHash('sha256').update(stableContentJson(value)).digest('hex');
}

export function compileContentPackage(
  manifest: ContentManifest,
): CompiledContentPackage {
  const { sourceFingerprints: _sourceFingerprints, ...mechanicalContent } = manifest;
  const canonicalJson = stableContentJson(mechanicalContent);
  return {
    hash: createHash('sha256').update(canonicalJson).digest('hex'),
    schemaVersion: manifest.schemaVersion,
    manifest,
    canonicalJson,
  };
}

const recordsByCategory = (
  records: readonly ContentSnapshotRecord[],
): Map<ContentCategory, Map<string, string>> => {
  const result = new Map<ContentCategory, Map<string, string>>();
  for (const category of CATEGORY_NAMES) result.set(category, new Map());
  for (const record of records) {
    result.get(record.category)!.set(record.key, stableContentHash(record.payload));
  }
  return result;
};

export function logicalContentDiff(
  previous: readonly ContentSnapshotRecord[],
  next: readonly ContentSnapshotRecord[],
): ContentLogicalDiff {
  const before = recordsByCategory(previous);
  const after = recordsByCategory(next);
  const diff: ContentLogicalDiff = { added: {}, removed: {}, changed: {} };

  for (const category of CATEGORY_NAMES) {
    const previousEntries = before.get(category)!;
    const nextEntries = after.get(category)!;
    const added = [...nextEntries.keys()]
      .filter((key) => !previousEntries.has(key))
      .sort();
    const removed = [...previousEntries.keys()]
      .filter((key) => !nextEntries.has(key))
      .sort();
    const changed = [...nextEntries.keys()]
      .filter(
        (key) =>
          previousEntries.has(key) && previousEntries.get(key) !== nextEntries.get(key),
      )
      .sort();
    if (added.length > 0) diff.added[category] = added;
    if (removed.length > 0) diff.removed[category] = removed;
    if (changed.length > 0) diff.changed[category] = changed;
  }

  return diff;
}
