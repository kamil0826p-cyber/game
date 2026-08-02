import { useEffect, useState } from 'react';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { CLOSE_GUILD_WINDOW_EVENT } from '../../game/guilds/guildUiEvents';
import { CLOSE_SOCIAL_WINDOW_EVENT, TOGGLE_SOCIAL_WINDOW_EVENT } from '../../game/social/socialUiEvents';
import { gameStore, useGameState } from '../../game/state/gameStore';
import { useSocialState } from '../../game/state/socialStore';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from '../modals/Modal';
import { CLOSE_SETTINGS_WINDOW_EVENT } from '../settings/settingsUiEvents';
import { FinderTab } from './SocialFinderTab';
import { GuildTab } from './SocialGuildTab';
import { RecentTab } from './SocialRecentTab';
import { RegionTab } from './SocialRegionTab';

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));


export function SocialHubOverlay(): React.JSX.Element | null {
  const connection = useGameConnection();
  const game = useGameState();
  const [open, setOpen] = useState(false);
  useEffect(() => { if (game.activeModal) setOpen(false); }, [game.activeModal]);
  useEffect(() => {
    if (game.phase !== 'in-world' || !game.socketConnected) return;
    void connection.getSocial().catch(() => undefined);
  }, [connection, game.phase, game.socketConnected]);
  useEffect(() => {
    const close = () => setOpen(false);
    const toggle = () => {
      window.dispatchEvent(new Event(CLOSE_SETTINGS_WINDOW_EVENT));
      window.dispatchEvent(new Event(CLOSE_GUILD_WINDOW_EVENT));
      gameStore.setActiveModal(null);
      setOpen((value) => !value);
    };
    const keyboard = (event: KeyboardEvent) => {
      if (editable(event.target)) return;
      if (event.key === 'Escape' && open) {
        event.preventDefault();
        setOpen(false);
      } else if ((event.key === 'h' || event.key === 'H') && !gameStore.getSnapshot().activeModal) {
        event.preventDefault();
        toggle();
      }
    };
    window.addEventListener(TOGGLE_SOCIAL_WINDOW_EVENT, toggle);
    window.addEventListener(CLOSE_SOCIAL_WINDOW_EVENT, close);
    window.addEventListener('keydown', keyboard);
    return () => {
      window.removeEventListener(TOGGLE_SOCIAL_WINDOW_EVENT, toggle);
      window.removeEventListener(CLOSE_SOCIAL_WINDOW_EVENT, close);
      window.removeEventListener('keydown', keyboard);
    };
  }, [open]);
  return open ? <SocialHubModal onClose={() => setOpen(false)} /> : null;
}

function SocialHubModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const connection = useGameConnection();
  const game = useGameState();
  const social = useSocialState();
  const { locale } = useI18n();
  const pl = locale === 'pl';
  const [tab, setTab] = useState<'finder' | 'recent' | 'guild' | 'region'>('finder');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try { await operation(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const tabs = [
    ['finder', pl ? 'Finder' : 'Finder'],
    ['recent', pl ? 'Ostatni i mentorzy' : 'Recent & mentors'],
    ['guild', pl ? 'Gildia' : 'Guild'],
    ['region', pl ? 'Region' : 'Region'],
  ] as const;
  return (
    <Modal
      title={pl ? 'Centrum społeczności' : 'Social hub'}
      subtitle={pl ? 'Grupy, kontrakty, mentoring i wspólne cele' : 'Parties, contracts, mentoring and shared goals'}
      icon="✥"
      onClose={onClose}
      widthClass="max-w-6xl"
    >
      <div className="mb-4 flex flex-wrap gap-2 border-b border-white/10 pb-3">
        {tabs.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`rounded-md border px-3 py-1.5 text-xs ${tab === key ? 'border-amber-300/40 bg-amber-300/10 text-amber-100' : 'border-white/10 text-slate-400 hover:text-slate-200'}`}>{label}</button>
        ))}
      </div>
      {error ? <p className="mb-4 rounded-lg border border-rose-400/25 bg-rose-950/30 p-3 text-sm text-rose-200">{error}</p> : null}
      {tab === 'finder' ? <FinderTab selfId={game.self?.characterId} busy={busy} pl={pl} run={run} /> : null}
      {tab === 'recent' ? <RecentTab busy={busy} pl={pl} run={run} /> : null}
      {tab === 'guild' ? <GuildTab busy={busy} pl={pl} run={run} /> : null}
      {tab === 'region' ? <RegionTab pl={pl} /> : null}
      <div className="mt-5 grid gap-2 text-[10px] text-slate-500 sm:grid-cols-4">
        <Metric label={pl ? 'Wypełnienie' : 'Fill rate'} value={social.metrics.fillRate} />
        <Metric label={pl ? 'Rozpad lobby' : 'Lobby dropoff'} value={social.metrics.lobbyDropoffRate} />
        <Metric label={pl ? 'Mentoring' : 'Mentoring'} value={social.metrics.mentoringCompletionRate} />
        <Metric label={pl ? 'Koncentracja nagród' : 'Reward concentration'} value={social.metrics.rewardConcentration} />
      </div>
    </Modal>
  );
}

function Metric({ label, value }: { label: string; value: number }): React.JSX.Element {
  return <div className="rounded border border-white/5 bg-black/20 px-2 py-1"><span>{label}</span><strong className="ml-2 text-amber-200">{Math.round(value * 100)}%</strong></div>;
}

