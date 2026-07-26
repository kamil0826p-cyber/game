import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { LocaleToggle } from '../../components/common/LocaleToggle';
import {
  LOCAL_PLAYER_SCREEN_EVENT,
  type LocalPlayerScreenPosition,
} from '../../game/engine/GameEngine';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { ModalHost } from '../modals/ModalHost';
import { ActionBar } from './ActionBar';
import { ChatPanel } from './ChatPanel';
import { ConnectionOverlay } from './ConnectionOverlay';
import { HudButtons } from './HudButtons';
import { MiniMap } from './MiniMap';
import { Notifications } from './Notifications';
import { PortalTransition } from './PortalTransition';
import { StatusPanel } from './StatusPanel';

const PLAYER_HALF_WIDTH = 48;
const PLAYER_TOP_OFFSET = 92;
const PLAYER_BOTTOM_OFFSET = 18;

export function GameHud(): React.JSX.Element | null {
  const state = useGameState();
  const { signOut } = useAuth();
  const { t } = useI18n();
  const statusPanelRef = useRef<HTMLDivElement | null>(null);
  const [statusOccluded, setStatusOccluded] = useState(false);

  useEffect(() => {
    const handlePlayerPosition = (event: Event) => {
      const position = (event as CustomEvent<LocalPlayerScreenPosition>).detail;
      const panel = statusPanelRef.current;
      if (!panel || !position) {
        return;
      }
      const panelRect = panel.getBoundingClientRect();
      const playerLeft = position.x - PLAYER_HALF_WIDTH;
      const playerRight = position.x + PLAYER_HALF_WIDTH;
      const playerTop = position.y - PLAYER_TOP_OFFSET;
      const playerBottom = position.y + PLAYER_BOTTOM_OFFSET;
      const overlaps =
        playerRight >= panelRect.left &&
        playerLeft <= panelRect.right &&
        playerBottom >= panelRect.top &&
        playerTop <= panelRect.bottom;
      setStatusOccluded((current) => (current === overlaps ? current : overlaps));
    };

    window.addEventListener(LOCAL_PLAYER_SCREEN_EVENT, handlePlayerPosition);
    return () => window.removeEventListener(LOCAL_PLAYER_SCREEN_EVENT, handlePlayerPosition);
  }, []);

  if (!state.self || !state.map) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none text-slate-100">
      <div
        ref={statusPanelRef}
        className={`absolute left-3 top-3 transition-opacity duration-150 ${statusOccluded ? 'opacity-20' : 'opacity-100'}`}
      >
        <StatusPanel character={state.self} map={state.map} />
      </div>
      <div className="absolute right-3 top-3 hidden sm:block"><MiniMap map={state.map} character={state.self} players={state.players} /></div>
      <div className="absolute bottom-3 left-3 hidden md:block"><ChatPanel notifications={state.notifications} /></div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2"><ActionBar /></div>
      <div className="absolute right-3 top-1/2 -translate-y-1/2"><HudButtons /></div>
      <div className="pointer-events-auto absolute right-3 top-[190px] hidden items-center gap-2 sm:flex">
        <LocaleToggle />
        <button type="button" onClick={() => void signOut()} className="rounded border border-slate-600/60 bg-slate-950/70 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 hover:border-rose-400/50 hover:text-rose-200">
          {t('hud.signOut')}
        </button>
      </div>
      <div className="absolute bottom-[82px] right-3 hidden max-w-xs rounded border border-white/10 bg-slate-950/60 p-2 text-[10px] leading-4 text-slate-400 lg:block">
        <p>{t('game.controls')}</p><p>{t('game.stopPath')}</p>
      </div>
      <Notifications notifications={state.notifications} />
      <PortalTransition state={state.portalTransition} />
      <ConnectionOverlay reconnecting={state.phase === 'reconnecting'} />
      <ModalHost />
    </div>
  );
}
