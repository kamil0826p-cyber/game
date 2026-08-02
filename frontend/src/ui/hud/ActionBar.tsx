import { useEffect, useMemo, useRef, useState } from 'react';
import type { SkillBuildSnapshot } from '../../contracts/skillBuild';
import type { SkillDefinitionPayload } from '../../contracts/socket';
import type { CombatLegalActionPayload } from '../../contracts/tacticalCombat';
import { isCombatActionTargetReady } from '../../game/combat/combatTargeting';
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
  legalActionsBySkill?: Readonly<Record<string, CombatLegalActionPayload>>;
  selectedTargetId?: string;
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
  legalActionsBySkill,
  selectedTargetId,
}: ActionBarProps = {}): React.JSX.Element {
  const { locale, t } = useI18n();
  const state = useGameState();
  const [active, setActive] = useState<number>();
  const intentLocked = useRef(false);
  const build = state.skillTree as SkillBuildSnapshot | undefined;
  const slots = useMemo(() => {
    const activeKeys = new Set(
      build
        ? build.activeLoadout?.isValid
          ? build.activeLoadout.activeSkillKeys
          : []
        : (state.skillTree?.skills ?? [])
            .filter((skill) => skill.rank > 0)
            .map((skill) => skill.key),
    );
    return [...(state.skillTree?.skills ?? [])]
      .filter((skill) => activeKeys.has(skill.key) && skill.rank > 0)
      .sort((first, second) => {
        const firstIndex = build?.activeLoadout?.activeSkillKeys.indexOf(first.key) ?? -1;
        const secondIndex = build?.activeLoadout?.activeSkillKeys.indexOf(second.key) ?? -1;
        if (firstIndex >= 0 && secondIndex >= 0) return firstIndex - secondIndex;
        return first.displayOrder - second.displayOrder;
      })
      .slice(0, build?.activeActionLimit ?? 8);
  }, [build, state.skillTree]);

  const activate = (skill: SkillDefinitionPayload, index: number): void => {
    const legalAction = legalActionsBySkill?.[skill.key];
    const combatTargetBlocked =
      legalActionsBySkill !== undefined &&
      !isCombatActionTargetReady(legalAction, selectedTargetId);
    if (
      intentLocked.current ||
      disabled ||
      combatTargetBlocked ||
      !state.self ||
      getSkillUseBlockReason(skill, state.self.combatState, state.self.energy)
    ) {
      return;
    }
    intentLocked.current = true;
    setActive(index);
    window.dispatchEvent(
      new CustomEvent<CombatSkillIntent>(COMBAT_SKILL_INTENT_EVENT, {
        detail: { skillKey: skill.key },
      }),
    );
    window.setTimeout(() => {
      intentLocked.current = false;
      setActive((current) => (current === index ? undefined : current));
    }, 180);
  };

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.repeat || isEditable(event.target)) return;
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
        const legalAction = legalActionsBySkill?.[skill.key];
        const combatRestricted = legalActionsBySkill !== undefined;
        const lacksLegalAction = combatRestricted && !legalAction;
        const targetMismatch = Boolean(
          legalAction && !isCombatActionTargetReady(legalAction, selectedTargetId),
        );
        const combatTargetBlocked = lacksLegalAction || targetMismatch;
        const noActionLabel =
          locale === 'pl' ? 'Umiejętność niedostępna w tej turze' : 'Skill unavailable this turn';
        const targetMismatchLabel =
          locale === 'pl'
            ? 'Zaznacz cel odpowiedni dla tej umiejętności'
            : 'Select a valid target for this skill';
        const reason =
          disabled && !blockReason
            ? (disabledLabel ?? t('hud.action.ready'))
            : lacksLegalAction
              ? noActionLabel
              : targetMismatch
                ? targetMismatchLabel
                : blockReason
                  ? t(blockReasonLabelKey[blockReason])
                  : t('hud.action.ready');
        const cooldownLabel = `${skill.cooldownTurnsRemaining}/${skill.cooldownTurns}`;
        const legalTargets = legalAction?.targetActorIds.length;
        const targetLabel =
          legalTargets === undefined
            ? skill.targeting
            : locale === 'pl'
              ? `${skill.targeting} · cele ${legalTargets}`
              : `${skill.targeting} · targets ${legalTargets}`;

        return (
          <span key={skill.key} className="hud-tooltip-anchor">
            <button
              type="button"
              aria-label={`${localized.name} (${index + 1}): ${reason}`}
              disabled={disabled || combatTargetBlocked || blockReason !== undefined}
              onClick={() => activate(skill, index)}
              className={[
                'action-slot',
                skill.rank < 1 ? 'action-slot-locked' : '',
                (blockReason || combatTargetBlocked) && skill.rank > 0
                  ? 'action-slot-disabled'
                  : '',
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
              <small>
                {locale === 'pl' ? 'Energia' : 'Energy'}: {skill.energyCost} ·{' '}
                {locale === 'pl' ? 'Odnowienie' : 'Cooldown'}: {cooldownLabel}
              </small>
              <small>{targetLabel}</small>
              <kbd>{index + 1}</kbd>
            </span>
          </span>
        );
      })}
    </section>
  );
}
