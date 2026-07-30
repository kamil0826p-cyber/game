import { useEffect, useState } from 'react';
import { TOGGLE_GUILD_WINDOW_EVENT } from '../../game/guilds/guildUiEvents';
import { gameStore, useGameState } from '../../game/state/gameStore';
import { GuildModal } from './GuildModal';

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function GuildOverlay(): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const activeModal = useGameState().activeModal;
  useEffect(() => { if (activeModal) setOpen(false); }, [activeModal]);
  useEffect(() => {
    const toggle = () => {
      gameStore.setActiveModal(null);
      setOpen((current) => !current);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (editable(event.target)) return;
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
      } else if ((event.key === 'g' || event.key === 'G') && !gameStore.getSnapshot().activeModal) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener(TOGGLE_GUILD_WINDOW_EVENT, toggle);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener(TOGGLE_GUILD_WINDOW_EVENT, toggle);
      window.removeEventListener('keydown', keyboard);
    };
  }, [open]);
  return open ? <GuildModal onClose={() => setOpen(false)} /> : null;
}
