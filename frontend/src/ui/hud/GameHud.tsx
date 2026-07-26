import { useAuth } from '../../auth/AuthProvider';
import { LocaleToggle } from '../../components/common/LocaleToggle';
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

export function GameHud(): React.JSX.Element | null {
  const state = useGameState();
  const { signOut } = useAuth();
  const { t } = useI18n();
  if (!state.self || !state.map) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none text-slate-100">
      <div className="absolute left-3 top-3"><StatusPanel character={state.self} map={state.map} /></div>
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
