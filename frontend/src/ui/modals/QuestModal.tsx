import { useState } from 'react';
import { MOCK_QUESTS } from '../../mock/mockData';
import { Modal } from './Modal';

export function QuestModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [selected, setSelected] = useState(0);
  const quest = MOCK_QUESTS[selected] ?? MOCK_QUESTS[0]!;
  return (
    <Modal title="Quest Log" subtitle="Static quest previews" icon="▱" onClose={onClose} widthClass="max-w-3xl">
      <div className="grid gap-4 sm:grid-cols-[240px_1fr]">
        <nav className="space-y-2">
          {MOCK_QUESTS.map((entry, index) => (
            <button key={entry.title} type="button" onClick={() => setSelected(index)} className={`quest-row ${selected === index ? 'quest-row-selected' : ''}`}>
              <strong>{entry.title}</strong><span>{entry.category}</span>
            </button>
          ))}
        </nav>
        <article className="rounded-xl border border-white/10 bg-slate-950/45 p-5">
          <p className="eyebrow">{quest.category}</p>
          <h3 className="font-display mt-2 text-2xl text-amber-100">{quest.title}</h3>
          <p className="mt-4 text-sm leading-6 text-slate-300">{quest.objective}</p>
          <div className="mt-6 flex items-center justify-between rounded-lg border border-white/10 bg-white/5 p-3 text-sm">
            <span className="text-slate-400">Progress</span><strong className="text-amber-200">{quest.progress}</strong>
          </div>
        </article>
      </div>
      <p className="mock-banner mt-5">Quest acceptance, objective tracking, rewards, and backend persistence are not implemented.</p>
    </Modal>
  );
}
