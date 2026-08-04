import { useCallback, useEffect, useState } from 'react';
import { CLOSE_GUILD_WINDOW_EVENT } from '../../game/guilds/guildUiEvents';
import { CLOSE_REWARD_CLAIMS_WINDOW_EVENT } from '../../game/rewards/rewardClaimsUiEvents';
import { gameStore, type ModalKey } from '../../game/state/gameStore';
import { SettingsModal } from './SettingsModal';
import {
  CLOSE_SETTINGS_WINDOW_EVENT,
  TOGGLE_SETTINGS_WINDOW_EVENT,
} from './settingsUiEvents';

const blockedModal = (modal: ModalKey): boolean =>
  modal === 'trade' ||
  modal === 'combat' ||
  modal === 'npc-dialogue' ||
  modal === 'merchant';

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function SettingsOverlay(): React.JSX.Element | null {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => {
    const activeModal = gameStore.getSnapshot().activeModal;
    if (blockedModal(activeModal)) return;
    window.dispatchEvent(new Event(CLOSE_GUILD_WINDOW_EVENT));
    window.dispatchEvent(new Event(CLOSE_REWARD_CLAIMS_WINDOW_EVENT));
    if (activeModal) {
      gameStore.setActiveModal(null);
      setOpen(true);
      return;
    }
    setOpen((current) => !current);
  }, []);

  useEffect(() => {
    const closeWhenAnotherModalOpens = gameStore.subscribe(() => {
      if (gameStore.getSnapshot().activeModal) setOpen(false);
    });
    return closeWhenAnotherModalOpens;
  }, []);

  useEffect(() => {
    const close = (): void => setOpen(false);
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (editable(event.target)) return;
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === 'o' || event.key === 'O') {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener(TOGGLE_SETTINGS_WINDOW_EVENT, toggle);
    window.addEventListener(CLOSE_SETTINGS_WINDOW_EVENT, close);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener(TOGGLE_SETTINGS_WINDOW_EVENT, toggle);
      window.removeEventListener(CLOSE_SETTINGS_WINDOW_EVENT, close);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, toggle]);

  return open ? <SettingsModal onClose={() => setOpen(false)} /> : null;
}
