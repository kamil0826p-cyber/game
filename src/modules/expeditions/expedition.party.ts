import type { ExpeditionRunSnapshot, ExpeditionRunStatus } from './expedition.types.js';

export interface TrackedExpeditionParty {
  runId: string;
  status: ExpeditionRunStatus;
  memberCharacterIds: string[];
  pendingEncounter?: ExpeditionRunSnapshot['pendingEncounter'];
}

export type ExpeditionEncounterAuthorization =
  | { mode: 'OPEN_WORLD' }
  | {
      mode: 'EXPEDITION';
      allowed: boolean;
      runId: string;
      variantKey?: string;
    };

export function inspectExpeditionEncounterParty(
  trackedByCharacterId: ReadonlyMap<string, TrackedExpeditionParty>,
  characterIds: readonly string[],
  partySize: number,
  encounterKey: string,
  encounterVersion: number,
): ExpeditionEncounterAuthorization {
  const trackedEntries = characterIds.flatMap((characterId) => {
    const tracked = trackedByCharacterId.get(characterId);
    return tracked ? [tracked] : [];
  });
  if (trackedEntries.length === 0) return { mode: 'OPEN_WORLD' };

  const tracked = trackedEntries[0]!;
  const expectedMembers = new Set(tracked.memberCharacterIds);
  const requestedMembers = new Set(characterIds);
  const pending = tracked.pendingEncounter;
  const allowed =
    partySize === characterIds.length &&
    requestedMembers.size === characterIds.length &&
    trackedEntries.length === characterIds.length &&
    trackedEntries.every((entry) => entry.runId === tracked.runId) &&
    expectedMembers.size === requestedMembers.size &&
    [...expectedMembers].every((characterId) => requestedMembers.has(characterId)) &&
    tracked.status === 'ACTIVE' &&
    pending?.encounterKey === encounterKey &&
    pending.encounterVersion === encounterVersion;

  return {
    mode: 'EXPEDITION',
    allowed,
    runId: tracked.runId,
    ...(allowed && pending?.variantKey ? { variantKey: pending.variantKey } : {}),
  };
}
