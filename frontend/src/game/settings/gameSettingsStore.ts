import { useSyncExternalStore } from 'react';

export const GAME_SETTINGS_STORAGE_KEY = 'elderglen.game-settings.v1';

export interface GameSettings {
  musicEnabled: boolean;
}

export interface GameSettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const DEFAULT_GAME_SETTINGS: Readonly<GameSettings> = {
  musicEnabled: true,
};

export function parseGameSettings(serialized: string | null): GameSettings {
  if (!serialized) return { ...DEFAULT_GAME_SETTINGS };
  try {
    const candidate = JSON.parse(serialized) as unknown;
    if (!candidate || typeof candidate !== 'object') return { ...DEFAULT_GAME_SETTINGS };
    const musicEnabled = (candidate as { musicEnabled?: unknown }).musicEnabled;
    return {
      musicEnabled:
        typeof musicEnabled === 'boolean' ? musicEnabled : DEFAULT_GAME_SETTINGS.musicEnabled,
    };
  } catch {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

function browserStorage(): GameSettingsStorage | undefined {
  if (typeof window === 'undefined') return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export class GameSettingsStore {
  private state: GameSettings;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly storage: GameSettingsStorage | undefined = browserStorage()) {
    let serialized: string | null = null;
    try {
      serialized = storage?.getItem(GAME_SETTINGS_STORAGE_KEY) ?? null;
    } catch {
      serialized = null;
    }
    this.state = parseGameSettings(serialized);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getSnapshot = (): GameSettings => this.state;

  setMusicEnabled(musicEnabled: boolean): void {
    if (this.state.musicEnabled === musicEnabled) return;
    this.state = { ...this.state, musicEnabled };
    try {
      this.storage?.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Settings still work for the current session when storage is unavailable.
    }
    for (const listener of this.listeners) listener();
  }
}

export const gameSettingsStore = new GameSettingsStore();

export const useGameSettings = (): GameSettings =>
  useSyncExternalStore(
    gameSettingsStore.subscribe,
    gameSettingsStore.getSnapshot,
    gameSettingsStore.getSnapshot,
  );
