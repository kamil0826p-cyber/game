import { MOCK_SKILLS } from '../../mock/mockData';
import { Modal } from './Modal';

export function SkillModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <Modal title="Skill Tree" subtitle="Progression and specialization" icon="✦" onClose={onClose} widthClass="max-w-3xl">
      <div className="relative h-[430px] overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(circle_at_center,rgba(124,58,237,0.12),rgba(2,6,23,0.75)_60%)]">
        <svg className="absolute inset-0 size-full" aria-hidden="true">
          <line x1="50%" y1="18%" x2="25%" y2="48%" stroke="rgba(148,163,184,.3)" strokeWidth="2" />
          <line x1="50%" y1="18%" x2="75%" y2="48%" stroke="rgba(148,163,184,.3)" strokeWidth="2" />
          <line x1="25%" y1="48%" x2="50%" y2="80%" stroke="rgba(148,163,184,.3)" strokeWidth="2" />
          <line x1="75%" y1="48%" x2="50%" y2="80%" stroke="rgba(148,163,184,.3)" strokeWidth="2" />
        </svg>
        {MOCK_SKILLS.map((skill) => (
          <button key={skill.id} type="button" className={`skill-node ${skill.rank > 0 ? 'skill-node-active' : ''}`} style={{ left: `${skill.x}%`, top: `${skill.y}%` }} title={skill.label}>
            <span>✦</span><strong>{skill.label}</strong><small>Rank {skill.rank} / 5</small>
          </button>
        ))}
      </div>
      <p className="mock-banner mt-5">Skill points, prerequisites, effects, and server validation will be added in a future gameplay update.</p>
    </Modal>
  );
}
