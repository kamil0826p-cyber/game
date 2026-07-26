import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

const quests = [
  { id: 'light', title: 'modal.quests.light.title', category: 'modal.quests.light.category', objective: 'modal.quests.light.objective', progress: '0 / 1' },
  { id: 'greenfields', title: 'modal.quests.greenfields.title', category: 'modal.quests.greenfields.category', objective: 'modal.quests.greenfields.objective', progress: '1 / 3' },
  { id: 'supplies', title: 'modal.quests.supplies.title', category: 'modal.quests.supplies.category', objective: 'modal.quests.supplies.objective', progress: '3 / 8' },
] as const;

export function QuestModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const [selected, setSelected] = useState(0);
  const quest = quests[selected] ?? quests[0];
  return (
    <Modal title={t('modal.quests.title')} subtitle={t('modal.quests.subtitle')} icon="▱" onClose={onClose} widthClass="max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-[240px_1fr]">
        <nav className="space-y-2">
          {quests.map((entry, index) => (
            <button key={entry.id} type="button" onClick={() => setSelected(index)} className={`quest-row ${selected === index ? 'quest-row-selected' : ''}`}>
              <strong>{t(entry.title)}</strong><span>{t(entry.category)}</span>
            </button>
          ))}
        </nav>
        <article className="rounded-xl border border-white/10 bg-slate-950/45 p-5">
          <p className="eyebrow">{t(quest.category)}</p>
          <h3 className="font-display mt-2 text-2xl text-amber-100">{t(quest.title)}</h3>
          <p className="mt-4 text-sm leading-6 text-slate-300">{t(quest.objective)}</p>
          <div className="mt-6 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
            <span className="text-slate-400">{t('modal.quests.progress')}</span><strong className="text-amber-200">{quest.progress}</strong>
          </div>
        </article>
      </div>
      <p className="mock-banner mt-5">{t('modal.quests.banner')}</p>
    </Modal>
  );
}
