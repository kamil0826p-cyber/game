import { useEffect, useState } from 'react';
import { CLOSE_GUILD_WINDOW_EVENT } from '../../game/guilds/guildUiEvents';
import {
  CLOSE_REWARD_CLAIMS_WINDOW_EVENT,
  TOGGLE_REWARD_CLAIMS_WINDOW_EVENT,
} from '../../game/rewards/rewardClaimsUiEvents';
import { gameStore, useGameState, type ModalKey } from '../../game/state/gameStore';
import { CLOSE_SETTINGS_WINDOW_EVENT } from '../settings/settingsUiEvents';
import { RewardClaimsModal } from './RewardClaimsModal';

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

const blockedModal = (modal: ModalKey): boolean =>
  modal === 'trade' ||
  modal === 'combat' ||
  modal === 'npc-dialogue' ||
  modal === 'merchant';

const canOpen = (): boolean => {
  const state = gameStore.getSnapshot();
  return (
    state.phase === 'in-world' &&
    state.socketConnected &&
    state.self?.combatState === 'IDLE' &&
    !blockedModal(state.activeModal)
  );
};

export function RewardClaimsOverlay(): React.JSX.Element | null {
  const state = useGameState();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (
      state.activeModal ||
      state.phase !== 'in-world' ||
      state.self?.combatState !== 'IDLE'
    ) {
      setOpen(false);
    }
  }, [state.activeModal, state.phase, state.self?.combatState]);

  useEffect(() => {
    const close = () => setOpen(false);
    const toggle = () => {
      if (!open && !canOpen()) return;
      window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
      window.dispatchEvent(new Event(CLOSE_GUILD_WINDOW_EVENT));
      gameStore.setActiveModal(null);
      setOpen((current) => !current);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (editable(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
      } else if (event.key === 'r' || event.key === 'R') {
        if (!open && !canOpen()) return;
        event.preventDefault();
        window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
        window.dispatchEvent(new Event(CLOSE_GUILD_WINDOW_EVENT));
        gameStore.setActiveModal(null);
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
