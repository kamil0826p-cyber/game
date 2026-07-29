import { useEffect, useMemo, useState } from 'react';
import { getQuestLog } from '../../game/quests/questClient';
import type { QuestLogEntryPayload } from '../../game/quests/quest.types';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

const statusLabel = (status: QuestLogEntryPayload['status'], locale: 'pl' | 'en'): string => {
  if (status === 'READY') return locale === 'pl' ? 'Gotowe do oddania' : 'Ready to turn in';
  if (status === 'REWARDED') return locale === 'pl' ? 'Ukończone' : 'Completed';
  return locale === 'pl' ? 'W toku' : 'In progress';
};

export function QuestModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const connection = useGameConnection();
  const { t, locale } = useI18n();
  const [quests, setQuests] = useState<QuestLogEntryPayload[]>([]);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void getQuestLog(connection)
      .then((snapshot) => {
        if (cancelled) return;
        setQuests(snapshot.quests);
        setSelectedKey((current) => current && snapshot.quests.some((quest) => quest.key === current) ? current : snapshot.quests[0]?.key);
        setError(undefined);
      })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [connection]);

  const selected = useMemo(() => quests.find((quest) => quest.key === selectedKey) ?? quests[0], [quests, selectedKey]);
  return (
    <Modal title={t('modal.quests.title')} subtitle={t('modal.quests.subtitle')} icon="▱" onClose={onClose} widthClass="max-w-3xl">
      {loading ? <p className="py-10 text-center text-sm text-slate-400">{locale === 'pl' ? 'Wczytywanie dziennika zadań…' : 'Loading quest log…'}</p> : null}
      {!loading && error ? <p className="rounded-lg border border-rose-400/25 bg-rose-950/30 p-4 text-sm text-rose-200">{error}</p> : null}
      {!loading && !error && quests.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">{locale === 'pl' ? 'Nie masz jeszcze żadnych rozpoczętych zadań.' : 'You have not started any quests yet.'}</p> : null}
      {!loading && !error && selected ? (
        <div className="grid gap-4 sm:grid-cols-[240px_1fr]">
          <nav className="space-y-2">{quests.map((entry) => (
            <button key={entry.key} type="button" onClick={() => setSelectedKey(entry.key)} className={`quest-row ${selected.key === entry.key ? 'quest-row-selected' : ''}`}>
              <strong>{entry.name}</strong><span>{statusLabel(entry.status, locale)}</span>
            </button>
          ))}</nav>
          <article className="rounded-xl border border-white/10 bg-slate-950/45 p-5">
            <p className="eyebrow">{statusLabel(selected.status, locale)}</p>
            <h3 className="font-display mt-2 text-2xl text-amber-100">{selected.name}</h3>
            <p className="mt-4 text-sm leading-6 text-slate-300">{selected.description}</p>
            <div className="mt-5 space-y-2">{selected.objectives.map((objective) => (
              <div key={objective.id} className="flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
                <span className={objective.completed ? 'text-emerald-300' : 'text-slate-300'}>{objective.completed ? '✓ ' : ''}{objective.label}</span>
                <strong className="shrink-0 text-amber-200">{objective.current} / {objective.target}</strong>
              </div>
            ))}</div>
            <div className="mt-5 rounded-lg border border-amber-300/15 bg-amber-950/15 p-3 text-sm text-slate-300">
              <strong className="text-amber-200">{locale === 'pl' ? 'Nagrody' : 'Rewards'}:</strong>{' '}{selected.rewards.experience} XP
              {selected.rewards.gold > 0 ? ` · ${selected.rewards.gold} ${locale === 'pl' ? 'złota' : 'gold'}` : ''}
              {selected.rewards.silver > 0 ? ` · ${selected.rewards.silver} ${locale === 'pl' ? 'srebra' : 'silver'}` : ''}
            </div>
          </article>
        </div>
      ) : null}
    </Modal>
  );
}
