import { useEffect, useMemo, useState } from 'react';
import type { SkillDefinitionPayload } from '../../contracts/socket';
import { getSkillCopy } from '../../game/skills/skillCopy';
import { getSkillUseBlockReason } from '../../game/skills/skillUi';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';

export const COMBAT_SKILL_INTENT_EVENT = 'game:combat-skill-intent';

export interface CombatSkillIntent {
  skillKey: string;
}

interface ActionBarProps {
  disabled?: boolean;
  disabledLabel?: string;
}

const blockReasonLabelKey = {
  LOCKED: 'hud.action.locked',
  OUT_OF_COMBAT: 'hud.action.combatOnly',
  COOLDOWN: 'hud.action.cooldown',
  INSUFFICIENT_ENERGY: 'hud.action.noEnergy',
} as const;

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function ActionBar({
  disabled = false,
  disabledLabel,
}: ActionBarProps = {}): React.JSX.Element {
  const { locale, t } = useI18n();
  const state = useGameState();
  const [active, setActive] = useState<number>();
  const slots = useMemo(
    () => [...(state.skillTree?.skills ?? [])].sort((a, b) => a.displayOrder - b.displayOrder),
    [state.skillTree],
  );

  const activate = (skill: SkillDefinitionPayload, index: number): void => {
    if (
      disabled ||
      !state.self ||
      getSkillUseBlockReason(skill, state.self.combatState, state.self.energy)
    ) {
      return;
    }
    setActive(index);
    window.dispatchEvent(
      new CustomEvent<CombatSkillIntent>(COMBAT_SKILL_INTENT_EVENT, {
        detail: { skillKey: skill.key },
      }),
    );
    window.setTimeout(
      () => setActive((current) => (current === index ? undefined : current)),
      180,
    );
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (isEditable(event.target)) return;
      const index = Number(event.key) - 1;
      const skill = slots[index];
      if (skill) activate(skill, index);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  });

  return (
    <section
      className="hud-panel hud-tooltip-container pointer-events-auto flex gap-1.5 p-2"
      aria-label={t('hud.skills')}
    >
      {Array.from({ length: 8 }, (_, index) => {
        const skill = slots[index];
        if (!skill || !state.self) {
          return (
            <span key={index} className="action-slot action-slot-locked">
              <span>⌑</span>
              <kbd>{index + 1}</kbd>
            </span>
          );
        }

        const localized = getSkillCopy(skill.key, locale, skill);
        const blockReason = getSkillUseBlockReason(
          skill,
          state.self.combatState,
          state.self.energy,
        );
        const reason =
          disabled && !blockReason
            ? (disabledLabel ?? t('hud.action.ready'))
            : blockReason
              ? t(blockReasonLabelKey[blockReason])
              : t('hud.action.ready');

        return (
          <span key={skill.key} className="hud-tooltip-anchor">
            <button
              type="button"
              aria-label={`${localized.name} (${index + 1}): ${reason}`}
              disabled={disabled || blockReason !== undefined}
              onClick={() => activate(skill, index)}
              className={[
                'action-slot',
                skill.rank < 1 ? 'action-slot-locked' : '',
                blockReason && skill.rank > 0 ? 'action-slot-disabled' : '',
                active === index ? 'action-slot-active' : '',
              ].join(' ')}
              style={{ '--skill-accent': skill.visual.accentColor } as React.CSSProperties}
            >
              <span className="text-xl">{skill.icon}</span>
              <kbd>{index + 1}</kbd>
            </button>
            <span className="hud-tooltip-bubble hud-tooltip-bubble-top" role="tooltip">
              <span>{localized.name}</span>
              <small>{reason}</small>
              <kbd>{index + 1}</kbd>
            </span>
          </span>
        );
      })}
    </section>
  );
}
