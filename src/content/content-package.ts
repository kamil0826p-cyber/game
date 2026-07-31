import { createHash } from 'node:crypto';
import {
  compileContentSnapshot,
  type CompiledContentSnapshot,
  type ContentSnapshot,
} from './content-validator.js';

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

const stableProjection = (snapshot: ContentSnapshot): Record<string, unknown> => {
  const mapKeyById = new Map(snapshot.maps.map((map) => [map.id, map.key]));
  const skillKeyById = new Map(snapshot.skills.map((skill) => [skill.id, skill.key]));

  return {
    maps: snapshot.maps
      .map(({ id: _id, version: _version, ...map }) => map)
      .sort((left, right) => left.key.localeCompare(right.key)),
    portals: snapshot.portals
      .map((portal) => ({
        sourceMapKey: mapKeyById.get(portal.sourceMapId),
        sourceX: portal.sourceX,
        sourceY: portal.sourceY,
        destinationMapKey: mapKeyById.get(portal.destinationMapId),
        targetX: portal.targetX,
        targetY: portal.targetY,
      }))
      .sort((left, right) =>
        [
          left.sourceMapKey,
          left.sourceX,
          left.sourceY,
          left.destinationMapKey,
          left.targetX,
          left.targetY,
        ]
          .join(':')
          .localeCompare(
            [
              right.sourceMapKey,
              right.sourceX,
              right.sourceY,
              right.destinationMapKey,
              right.targetX,
              right.targetY,
            ].join(':'),
          ),
      ),
    items: snapshot.items
      .map(({ id: _id, ...item }) => item)
      .sort((left, right) => left.key.localeCompare(right.key)),
    skills: snapshot.skills
      .map(({ id: _id, ...skill }) => skill)
      .sort((left, right) => left.key.localeCompare(right.key)),
    skillPrerequisites: snapshot.skillPrerequisites
      .map((relation) => ({
        skillKey: skillKeyById.get(relation.skillDefinitionId),
        prerequisiteSkillKey: skillKeyById.get(relation.prerequisiteSkillDefinitionId),
      }))
      .sort((left, right) =>
        `${left.skillKey}:${left.prerequisiteSkillKey}`.localeCompare(
          `${right.skillKey}:${right.prerequisiteSkillKey}`,
        ),
      ),
    quests: snapshot.quests
      .map(({ id: _id, ...quest }) => quest)
      .sort((left, right) => left.key.localeCompare(right.key)),
    npcs: snapshot.npcs
      .map(({ id: _id, mapId, ...npc }) => ({
        ...npc,
        mapKey: mapKeyById.get(mapId),
      }))
      .sort((left, right) =>
        `${left.mapKey}:${left.key}`.localeCompare(`${right.mapKey}:${right.key}`),
      ),
    mobs: snapshot.mobs
      .map(({ id: _id, mapId, ...mob }) => ({
        ...mob,
        mapKey: mapKeyById.get(mapId),
      }))
      .sort((left, right) =>
        `${left.mapKey}:${left.key}`.localeCompare(`${right.mapKey}:${right.key}`),
      ),
  };
};

export const calculateStableContentHash = (snapshot: ContentSnapshot): string =>
  createHash('sha256').update(stableJson(stableProjection(snapshot))).digest('hex');

export const compileContentPackage = (input: unknown): CompiledContentSnapshot => {
  const compiled = compileContentSnapshot(input);
  return {
    snapshot: compiled.snapshot,
    hash: calculateStableContentHash(compiled.snapshot),
  };
};
