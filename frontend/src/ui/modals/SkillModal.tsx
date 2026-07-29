import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/common/Button';
import type { SkillDefinitionPayload, SkillUnlockState } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { getSkillCopy } from '../../game/skills/skillCopy';
import { getTreePosition } from '../../game/skills/skillUi';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

const stateLabelKey: Record<SkillUnlockState, Parameters<ReturnType<typeof useI18n>['t']>[0]> =
  {
    UNLOCKED: 'modal.skills.state.unlocked',
    AVAILABLE: 'modal.skills.state.available',
    LOCKED_LEVEL: 'modal.skills.state.level',
    LOCKED_PREREQUISITE: 'modal.skills.state.prerequisite',
    LOCKED_POINTS: 'modal.skills.state.points',
  };

const classLabelKey = {
  MAGE: 'class.mage',
  WARRIOR: 'class.warrior',
  ARCHER: 'class.archer',
} as const;

const targetLabelKey = {
  SELF: 'modal.skills.target.self',
  ENEMY: 'modal.skills.target.enemy',
  AREA: 'modal.skills.target.area',
} as const;

const getInitialSelection = (skills: readonly SkillDefinitionPayload[]): string =>
  skills.find((skill) => skill.unlockState === 'AVAILABLE')?.key ?? skills[0]?.key ?? '';

export function SkillModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { locale, t } = useI18n();
  const connection = useGameConnection();
  const tree = useGameState().skillTree;
  const [selectedKey, setSelectedKey] = useState(() => getInitialSelection(tree?.skills ?? []));
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    if (!tree || tree.skills.some((skill) => skill.key === selectedKey)) return;
    setSelectedKey(getInitialSelection(tree.skills));
  }, [selectedKey, tree]);

  const skillsByKey = useMemo(
    () => new Map(tree?.skills.map((skill) => [skill.key, skill]) ?? []),
    [tree],
  );
  const selected = skillsByKey.get(selectedKey) ?? tree?.skills[0];

  if (!tree || !selected) {
    return (
      <Modal
        title={t('modal.skills.title')}
        subtitle={t('modal.skills.subtitle')}
        icon="✦"
        onClose={onClose}
      >
        <p className="py-12 text-center text-sm text-slate-400">{t('common.loading')}…</p>
      </Modal>
    );
  }

  const selectedCopy = getSkillCopy(selected.key, locale, selected);
  const missingNames = selected.missingPrerequisiteKeys.map((key) => {
    const prerequisite = skillsByKey.get(key);
    return prerequisite ? getSkillCopy(key, locale, prerequisite).name : key;
  });

  const unlock = async (): Promise<void> => {
    if (selected.unlockState !== 'AVAILABLE' || unlocking) return;
    setUnlocking(true);
    try {
      await connection.unlockSkill(selected.key);
    } finally {
      setUnlocking(false);
    }
  };

  return (
    <Modal
      title={t('modal.skills.title')}
      subtitle={`${t(classLabelKey[tree.characterClass])} · ${t('common.level')} ${tree.characterLevel}`}
      icon="✦"
      onClose={onClose}
      widthClass="max-w-6xl"
    >
      <div className="skill-summary">
        <div>
          <span>{t('modal.skills.pointsAvailable')}</span>
          <strong>{tree.points.available}</strong>
        </div>
        <div>
          <span>{t('modal.skills.pointsEarned')}</span>
          <strong>{tree.points.earned}</strong>
        </div>
        <div>
          <span>{t('modal.skills.nextPoint')}</span>
          <strong>{tree.points.nextPointAtLevel ?? '—'}</strong>
        </div>
        <p>{t('modal.skills.pointRule')}</p>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="skill-tree-canvas">
          <svg className="absolute inset-0 size-full" aria-hidden="true">
            {tree.skills.flatMap((skill) => {
              const target = getTreePosition(skill);
              return skill.prerequisiteKeys.flatMap((key) => {
                const prerequisite = skillsByKey.get(key);
                if (!prerequisite) return [];
                const source = getTreePosition(prerequisite);
                const active = prerequisite.rank > 0 && skill.rank > 0;
                return (
                  <line
                    key={`${key}:${skill.key}`}
                    x1={`${source.x}%`}
                    y1={`${source.y}%`}
                    x2={`${target.x}%`}
                    y2={`${target.y}%`}
                    className={active ? 'skill-link skill-link-active' : 'skill-link'}
                  />
                );
              });
            })}
          </svg>

          {tree.skills.map((skill) => {
            const position = getTreePosition(skill);
            const localized = getSkillCopy(skill.key, locale, skill);
            const selectedNode = skill.key === selected.key;
            return (
              <button
                key={skill.key}
                type="button"
                className={[
                  'skill-node',
                  `skill-node-${skill.unlockState.toLowerCase().replaceAll('_', '-')}`,
                  selectedNode ? 'skill-node-selected' : '',
                ].join(' ')}
                style={
                  {
                    left: `${position.x}%`,
                    top: `${position.y}%`,
                    '--skill-accent': skill.visual.accentColor,
                  } as React.CSSProperties
                }
                aria-pressed={selectedNode}
                aria-label={`${localized.name}: ${t(stateLabelKey[skill.unlockState])}`}
                onClick={() => setSelectedKey(skill.key)}
              >
                <span aria-hidden="true">{skill.icon}</span>
                <strong>{localized.name}</strong>
                <small>
                  {skill.rank > 0
                    ? t('modal.skills.state.unlocked')
                    : `${t('common.level')} ${skill.minimumLevel}`}
                </small>
              </button>
            );
          })}
        </div>

        <aside className="skill-detail" aria-live="polite">
          <div className="skill-detail-icon" style={{ color: selected.visual.accentColor }}>
            {selected.icon}
          </div>
          <p className="skill-detail-state">{t(stateLabelKey[selected.unlockState])}</p>
          <h3>{selectedCopy.name}</h3>
          <p className="skill-detail-description">{selectedCopy.description}</p>

          <dl className="skill-detail-stats">
            <div>
              <dt>{t('modal.skills.energy')}</dt>
              <dd>{selected.energyCost}</dd>
            </div>
            <div>
              <dt>{t('modal.skills.cooldown')}</dt>
              <dd>{selected.cooldownTurns}</dd>
            </div>
            <div>
              <dt>{t('modal.skills.target')}</dt>
              <dd>{t(targetLabelKey[selected.targeting])}</dd>
            </div>
            <div>
              <dt>{t('modal.skills.requiredLevel')}</dt>
              <dd>{selected.minimumLevel}</dd>
            </div>
          </dl>

          {missingNames.length > 0 ? (
            <p className="skill-requirement">
              {t('modal.skills.requires')}: {missingNames.join(', ')}
            </p>
          ) : null}

          <Button
            className="mt-auto w-full"
            busy={unlocking}
            disabled={selected.unlockState !== 'AVAILABLE'}
            onClick={() => void unlock()}
          >
            {selected.unlockState === 'UNLOCKED'
              ? t('modal.skills.unlocked')
              : t('modal.skills.unlock')}
          </Button>
        </aside>
      </div>

      <p className="skill-combat-notice">{t('modal.skills.combatOnly')}</p>
    </Modal>
  );
}
