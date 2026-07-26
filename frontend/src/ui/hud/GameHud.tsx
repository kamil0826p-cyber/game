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
  return <div ref={elementRef} className={`hud-occludable ${className}`}>{children}</div>;
}

export function GameHud(): React.JSX.Element | null {
  const state = useGameState();
  const { signOut } = useAuth();
  const { t } = useI18n();
  const statusRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<HTMLDivElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const actionsRef = useRef<HTMLDivElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const utilityRef = useRef<HTMLDivElement | null>(null);
  const notificationsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const refs = [statusRef, mapRef, chatRef, actionsRef, menuRef, utilityRef, notificationsRef];
    const handlePlayerPosition = (event: Event) => {
      const position = (event as CustomEvent<LocalPlayerScreenPosition>).detail;
      if (!position) return;
      const player = {
        left: position.x - PLAYER_HALF_WIDTH,
        right: position.x + PLAYER_HALF_WIDTH,
        top: position.y - PLAYER_TOP_OFFSET,
        bottom: position.y + PLAYER_BOTTOM_OFFSET,
      };
      for (const ref of refs) {
        const element = ref.current;
        if (!element) continue;
        const rect = element.getBoundingClientRect();
        const overlaps = rect.width > 0 && rect.height > 0 &&
          player.right >= rect.left - OCCLUSION_PADDING &&
          player.left <= rect.right + OCCLUSION_PADDING &&
          player.bottom >= rect.top - OCCLUSION_PADDING &&
          player.top <= rect.bottom + OCCLUSION_PADDING;
        element.classList.toggle('hud-occluded', overlaps);
      }
    };
    window.addEventListener(LOCAL_PLAYER_SCREEN_EVENT, handlePlayerPosition);
    return () => window.removeEventListener(LOCAL_PLAYER_SCREEN_EVENT, handlePlayerPosition);
  }, []);

  if (!state.self || !state.map) return null;
  return (
    <div className="game-hud-root pointer-events-none absolute inset-0 z-10 select-none text-slate-100">
      <div className="hud-top-rail" />
      <HudAnchor elementRef={statusRef} className="absolute left-5 top-5">
        <StatusPanel character={state.self} map={state.map} />
      </HudAnchor>
      <HudAnchor elementRef={mapRef} className="absolute right-5 top-5 hidden sm:block">
        <MiniMap map={state.map} character={state.self} players={state.players} />
      </HudAnchor>
      <HudAnchor elementRef={chatRef} className="absolute bottom-5 left-5 hidden md:block">
        <ChatPanel notifications={state.notifications} />
      </HudAnchor>
      <HudAnchor elementRef={actionsRef} className="absolute bottom-5 left-1/2 -translate-x-1/2">
        <ActionBar />
      </HudAnchor>
      <HudAnchor elementRef={menuRef} className="absolute right-5 top-1/2 -translate-y-1/2">
        <HudButtons />
      </HudAnchor>
      <HudAnchor elementRef={utilityRef} className="absolute right-5 top-[220px] hidden sm:block">
        <div className="hud-utility-stack pointer-events-auto">
          <LocaleToggle />
          <button type="button" onClick={() => void signOut()} className="hud-signout-button" title={t('hud.signOut')}>↪</button>
        </div>
      </HudAnchor>
      <Notifications containerRef={notificationsRef} notifications={state.notifications} />
      <PortalTransition state={state.portalTransition} />
      <ConnectionOverlay reconnecting={state.phase === 'reconnecting'} />
      <ModalHost />
    </div>
  );
}
