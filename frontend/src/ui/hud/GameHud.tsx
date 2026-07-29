import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { LocaleToggle } from '../../components/common/LocaleToggle';
import {
  LOCAL_PLAYER_SCREEN_EVENT,
  type LocalPlayerScreenPosition,
} from '../../game/engine/GameEngine';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { ModalHost } from '../modals/ModalHost';
import { NpcInteractionLayer } from '../npcs/NpcInteractionLayer';
import { PlayerInteractionLayer } from '../interactions/PlayerInteractionLayer';
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
const OCCLUSION_PADDING = 6;
interface HudAnchorProps {
  elementRef: RefObject<HTMLDivElement | null>;
  className: string;
  children: ReactNode;
}
function HudAnchor({ elementRef, className, children }: HudAnchorProps): React.JSX.Element {
  return (
    <div ref={elementRef} className={`hud-occludable ${className}`}>
      {children}
    </div>
  );
}

export function GameHud(): React.JSX.Element | null {
  const state = useGameState();
  const { signOut } = useAuth();
  const { t } = useI18n();
  const statusPanelRef = useRef<HTMLDivElement | null>(null);
  const miniMapRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const actionBarRef = useRef<HTMLDivElement | null>(null);
  const windowButtonsRef = useRef<HTMLDivElement | null>(null);
  const utilityRef = useRef<HTMLDivElement | null>(null);
  const notificationsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const refs = [
      statusPanelRef,
      miniMapRef,
      chatRef,
      actionBarRef,
      windowButtonsRef,
      utilityRef,
      notificationsRef,
    ];
    const handlePlayerPosition = (event: Event) => {
      const position = (event as CustomEvent<LocalPlayerScreenPosition>).detail;
      if (!position) return;
      const playerLeft = position.x - PLAYER_HALF_WIDTH;
      const playerRight = position.x + PLAYER_HALF_WIDTH;
      const playerTop = position.y - PLAYER_TOP_OFFSET;
      const playerBottom = position.y + PLAYER_BOTTOM_OFFSET;
      for (const ref of refs) {
        const element = ref.current;
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        const rendered = rect.width > 0 && rect.height > 0;
        const overlaps =
          rendered &&
          playerRight >= rect.left - OCCLUSION_PADDING &&
          playerLeft <= rect.right + OCCLUSION_PADDING &&
          playerBottom >= rect.top - OCCLUSION_PADDING &&
          playerTop <= rect.bottom + OCCLUSION_PADDING;
        element.classList.toggle('hud-occluded', overlaps);
      }
    };
    window.addEventListener(LOCAL_PLAYER_SCREEN_EVENT, handlePlayerPosition);
    return () => {
      window.removeEventListener(LOCAL_PLAYER_SCREEN_EVENT, handlePlayerPosition);
      for (const ref of refs) ref.current?.classList.remove('hud-occluded');
    };
  }, []);
  if (!state.self || !state.map) return null;
  return (
    <div className="game-hud-root pointer-events-none absolute inset-0 z-10 select-none text-slate-100">
      <HudAnchor elementRef={statusPanelRef} className="absolute left-3 top-3">
        <StatusPanel character={state.self} map={state.map} />
      </HudAnchor>
      <HudAnchor elementRef={miniMapRef} className="absolute right-3 top-3 hidden sm:block">
        <MiniMap map={state.map} character={state.self} players={state.players} />
      </HudAnchor>
      <HudAnchor elementRef={chatRef} className="absolute bottom-3 left-3 hidden md:block">
        <ChatPanel notifications={state.notifications} />
      </HudAnchor>
      {state.self.combatState === 'IDLE' ? (
        <HudAnchor
          elementRef={actionBarRef}
          className="absolute bottom-3 left-1/2 -translate-x-1/2"
        >
          <ActionBar />
        </HudAnchor>
      ) : null}
      <HudAnchor
        elementRef={windowButtonsRef}
        className="absolute right-3 top-1/2 -translate-y-1/2"
      >
        <HudButtons />
      </HudAnchor>
      <HudAnchor elementRef={utilityRef} className="absolute bottom-3 right-3 hidden sm:block">
        <div className="hud-utility-bar pointer-events-auto flex items-center gap-2">
          <LocaleToggle />
          <button type="button" onClick={() => void signOut()} className="hud-utility-button">
            {t('hud.signOut')}
          </button>
        </div>
      </HudAnchor>
      <Notifications containerRef={notificationsRef} notifications={state.notifications} />
      <PortalTransition state={state.portalTransition} />
      <ConnectionOverlay reconnecting={state.phase === 'reconnecting'} />
      <ModalHost />
      <NpcInteractionLayer />
      <PlayerInteractionLayer />
    </div>
  );
}
