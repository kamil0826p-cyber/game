import { useEffect, useState } from 'react';
import {
  CLOSE_REWARD_CLAIMS_WINDOW_EVENT,
  TOGGLE_REWARD_CLAIMS_WINDOW_EVENT,
} from '../../game/rewards/rewardClaimsUiEvents';
import { gameStore, useGameState } from '../../game/state/gameStore';
import { CLOSE_SETTINGS_WINDOW_EVENT } from '../settings/settingsUiEvents';
import { RewardClaimsModal } from './RewardClaimsModal';

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function RewardClaimsOverlay(): React.JSX.Element | null {
  const state = useGameState();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.activeModal || state.phase !== 'in-world') setOpen(false);
  }, [state.activeModal, state.phase]);

  useEffect(() => {
    const close = () => setOpen(false);
    const toggle = () => {
      window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
      gameStore.setActiveModal(null);
      setOpen((current) => !current);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (editable(event.target)) return;
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
      } else if (
        (event.key === 'r' || event.key === 'R') &&
        !gameStore.getSnapshot().activeModal
      ) {
        event.preventDefault();
        window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
        setOpen((current) => !current);
      }
    };
    window.addEventListener(TOGGLE_REWARD_CLAIMS_WINDOW_EVENT, toggle);
    window.addEventListener(CLOSE_REWARD_CLAIMS_WINDOW_EVENT, close);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener(TOGGLE_REWARD_CLAIMS_WINDOW_EVENT, toggle);
      window.removeEventListener(CLOSE_REWARD_CLAIMS_WINDOW_EVENT, close);
      window.removeEventListener('keydown', keyboard);
    };
  }, [open]);

  return open ? <RewardClaimsModal onClose={() => setOpen(false)} /> : null;
}
