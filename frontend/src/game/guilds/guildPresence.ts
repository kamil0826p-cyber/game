import type { GuildSnapshot } from '../../contracts/guild';

let memberIds = new Set<string>();
const listeners = new Set<() => void>();

export function setGuildPresence(snapshot: GuildSnapshot): void {
  memberIds = new Set(snapshot.guild?.members.map((member) => member.characterId) ?? []);
  for (const listener of listeners) listener();
}

export function clearGuildPresence(): void {
  memberIds = new Set();
  for (const listener of listeners) listener();
}

export function isGuildMate(characterId: string): boolean {
  return memberIds.has(characterId);
}

export function subscribeGuildPresence(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
