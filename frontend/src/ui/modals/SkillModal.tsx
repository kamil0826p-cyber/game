import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { MOCK_SKILLS } from '../../mock/mockData';
import { Modal } from './Modal';

const skillLabelKey = {
  focus: 'modal.skills.focus',
  survival: 'modal.skills.survival',
  precision: 'modal.skills.precision',
  mastery: 'modal.skills.mastery',
} as const;

interface SkillTooltipState {
  id: string;
  label: string;
  rankLabel: string;
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

const TOOLTIP_EDGE_PADDING = 140;

export function SkillModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const [tooltip, setTooltip] = useState<SkillTooltipState>();

  useEffect(() => {
    if (!tooltip) return;

    const hideTooltip = () => setTooltip(undefined);
    window.addEventListener('resize', hideTooltip);
    window.addEventListener('scroll', hideTooltip, true);
    return () => {
      window.removeEventListener('resize', hideTooltip);
      window.removeEventListener('scroll', hideTooltip, true);
    };
  }, [tooltip]);

  const showTooltip = (
    anchor: HTMLElement,
    skillId: string,
    label: string,
    rank: number,
  ): void => {
    const bounds = anchor.getBoundingClientRect();
    const placement = bounds.top >= 72 ? 'top' : 'bottom';
    const minimumLeft = Math.min(TOOLTIP_EDGE_PADDING, window.innerWidth / 2);
    const maximumLeft = Math.max(minimumLeft, window.innerWidth - TOOLTIP_EDGE_PADDING);

    setTooltip({
      id: `skill-tooltip-${skillId}`,
      label,
      rankLabel: `${t('common.rank')} ${rank} / 5`,
      left: Math.max(minimumLeft, Math.min(maximumLeft, bounds.left + bounds.width / 2)),
      top: placement === 'top' ? bounds.top : bounds.bottom,
      placement,
    });
  };

  return (
    <Modal title={t('modal.skills.title')} subtitle={t('modal.skills.subtitle')} icon="✦" onClose={onClose} widthClass="max-w-3xl">
      <div className="relative h-[430px] overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(circle_at_center,rgba(124,58,237,0.12),rgba(2,6,23,0.75)_60%)]">
        <svg className="absolute inset-0 size-full" aria-hidden="true">
          <line x1="50%" y1="18%" x2="25%" y2="48%" stroke="rgba(148,163,184,.3)" strokeWidth="2" />
          <line x1="50%" y1="18%" x2="75%" y2="48%" stroke="rgba(148,163,184,.3)" strokeWidth="2" />
          <line x1="25%" y1="48%" x2="50%" y2="80%" stroke="rgba(148,163,184,.3)" strokeWidth="2" />
          <line x1="75%" y1="48%" x2="50%" y2="80%" stroke="rgba(148,163,184,.3)" strokeWidth="2" />
        </svg>
        {MOCK_SKILLS.map((skill) => {
          const label = t(skillLabelKey[skill.id]);
          const rankLabel = `${t('common.rank')} ${skill.rank} / 5`;
          const tooltipId = `skill-tooltip-${skill.id}`;

          return (
            <button
              key={skill.id}
              type="button"
              className={`skill-node ${skill.rank > 0 ? 'skill-node-active' : ''}`}
              style={{ left: `${skill.x}%`, top: `${skill.y}%` }}
              aria-label={`${label}, ${rankLabel}`}
              aria-describedby={tooltip?.id === tooltipId ? tooltipId : undefined}
              onPointerEnter={(event) => showTooltip(event.currentTarget, skill.id, label, skill.rank)}
              onPointerLeave={() => setTooltip(undefined)}
              onFocus={(event) => showTooltip(event.currentTarget, skill.id, label, skill.rank)}
              onBlur={() => setTooltip(undefined)}
            >
              <span>✦</span><strong>{label}</strong><small>{rankLabel}</small>
            </button>
          );
        })}
      </div>
      <p className="mock-banner mt-5">{t('modal.skills.banner')}</p>
      {tooltip ? createPortal(
        <span
          id={tooltip.id}
          className="hud-tooltip-bubble"
          role="tooltip"
          style={{
            position: 'fixed',
            left: tooltip.left,
            top: tooltip.top,
            opacity: 1,
            visibility: 'visible',
            transform: tooltip.placement === 'top'
              ? 'translate(-50%, calc(-100% - 10px))'
              : 'translate(-50%, 10px)',
          }}
        >
          <span>{tooltip.label}</span>
          <kbd>{tooltip.rankLabel}</kbd>
        </span>,
        document.body,
      ) : null}
    </Modal>
  );
}
