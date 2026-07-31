import { describe, expect, it, vi } from 'vitest';
import {
  GAME_SETTINGS_STORAGE_KEY,
  GameSettingsStore,
  parseGameSettings,
  type GameSettingsStorage,
} from '../src/game/settings/gameSettingsStore';
import {
  BACKGROUND_MUSIC_TRACKS,
  pickBackgroundMusicTrack,
} from '../src/game/audio/BackgroundMusic';

class MemoryStorage implements GameSettingsStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('game settings', () => {
  it('defaults music to enabled for missing or invalid persisted values', () => {
    expect(parseGameSettings(null)).toEqual({ musicEnabled: true });
    expect(parseGameSettings('{broken')).toEqual({ musicEnabled: true });
    expect(parseGameSettings('{"musicEnabled":"no"}')).toEqual({ musicEnabled: true });
  });

  it('restores and persists the music preference', () => {
    const storage = new MemoryStorage();
    storage.setItem(GAME_SETTINGS_STORAGE_KEY, JSON.stringify({ musicEnabled: false }));
    const store = new GameSettingsStore(storage);
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.getSnapshot().musicEnabled).toBe(false);
    store.setMusicEnabled(true);

    expect(listener).toHaveBeenCalledOnce();
    expect(JSON.parse(storage.getItem(GAME_SETTINGS_STORAGE_KEY)!)).toEqual({
      musicEnabled: true,
    });
  });

  it('selects a track from the full random range', () => {
    expect(pickBackgroundMusicTrack(() => 0)).toBe(BACKGROUND_MUSIC_TRACKS[0]);
    expect(pickBackgroundMusicTrack(() => 0.999999)).toBe(BACKGROUND_MUSIC_TRACKS[1]);
  });
});
