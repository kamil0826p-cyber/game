import { useEffect, useState } from 'react';
import { TOGGLE_GUILD_WINDOW_EVENT } from '../../game/guilds/guildUiEvents';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { gameStore, useGameState } from '../../game/state/gameStore';
import { GuildModal } from './GuildModal';

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function GuildOverlay(): React.JSX.Element | null {
  const connection = useGameConnection();
  const state = useGameState();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (state.activeModal) setOpen(false); }, [state.activeModal]);
  useEffect(() => {
    if (state.phase !== 'in-world' || !state.socketConnected) return;
    void connection.getGuild().catch(() => undefined);
  }, [connection, state.phase, state.socketConnected]);
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
