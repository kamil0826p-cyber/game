import type { MobStatePayload } from '../../contracts/mob';

class MobStore {
  private mobs: Readonly<Record<string, MobStatePayload>> = {};
  private readonly listeners = new Set<() => void>();

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot(): Readonly<Record<string, MobStatePayload>> {
    return this.mobs;
  }

  replace(mapId: string, mobs: readonly MobStatePayload[]): void {
    const currentMapId = Object.values(this.mobs)[0]?.mapId;
    if (currentMapId && currentMapId !== mapId) this.mobs = {};
    this.mobs = Object.fromEntries(mobs.map((mob) => [mob.id, mob]));
    this.emit();
  }

  upsert(mob: MobStatePayload): void {
    this.mobs = { ...this.mobs, [mob.id]: mob };
    this.emit();
  }

  remove(mobId: string): void {
    if (!this.mobs[mobId]) return;
    const next = { ...this.mobs };
    delete next[mobId];
    this.mobs = next;
    this.emit();
  }

  clear(): void {
    if (Object.keys(this.mobs).length === 0) return;
    this.mobs = {};
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export const mobStore = new MobStore();
