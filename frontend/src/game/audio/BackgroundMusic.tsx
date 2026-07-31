import { useEffect, useRef } from 'react';
import { useGameSettings } from '../settings/gameSettingsStore';

export const BACKGROUND_MUSIC_TRACKS = [
  '/audio/music/1.mp3',
  '/audio/music/2.mp3',
] as const;

export function pickBackgroundMusicTrack(random: () => number = Math.random): string {
  const value = random();
  const normalized = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999) : 0;
  return BACKGROUND_MUSIC_TRACKS[
    Math.floor(normalized * BACKGROUND_MUSIC_TRACKS.length)
  ]!;
}

function autoplayWasBlocked(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}

export function BackgroundMusic(): null {
  const { musicEnabled } = useGameSettings();
  const enabledRef = useRef(musicEnabled);
  const syncPlaybackRef = useRef<() => void>(() => undefined);
  enabledRef.current = musicEnabled;

  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.volume = 0.35;
    let retryArmed = false;

    const clearRetry = (): void => {
      if (!retryArmed) return;
      retryArmed = false;
      window.removeEventListener('pointerdown', retryPlayback);
      window.removeEventListener('keydown', retryPlayback);
    };

    const selectRandomTrack = (): void => {
      audio.src = pickBackgroundMusicTrack();
      audio.currentTime = 0;
    };

    const armRetry = (): void => {
      if (retryArmed || !enabledRef.current) return;
      retryArmed = true;
      window.addEventListener('pointerdown', retryPlayback, { once: true });
      window.addEventListener('keydown', retryPlayback, { once: true });
    };

    const syncPlayback = (): void => {
      if (!enabledRef.current) {
        clearRetry();
        audio.pause();
        return;
      }
      if (!audio.src) selectRandomTrack();
      void audio.play().then(clearRetry).catch((error: unknown) => {
        if (autoplayWasBlocked(error)) armRetry();
      });
    };

    function retryPlayback(): void {
      clearRetry();
      syncPlayback();
    }

    const playNextTrack = (): void => {
      if (!enabledRef.current) return;
      selectRandomTrack();
      syncPlayback();
    };

    audio.addEventListener('ended', playNextTrack);
    syncPlaybackRef.current = syncPlayback;

    return () => {
      syncPlaybackRef.current = () => undefined;
      clearRetry();
      audio.removeEventListener('ended', playNextTrack);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    };
  }, []);

  useEffect(() => {
    syncPlaybackRef.current();
  }, [musicEnabled]);

  return null;
}
