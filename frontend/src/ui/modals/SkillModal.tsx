import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/common/Button';
import type {
  SkillBuildNodePayload,
  SkillBuildSnapshot,
  SkillFallbackAction,
  SkillLoadoutDefinition,
} from '../../contracts/skillBuild';
import type { SkillDefinitionPayload } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import '../../game/realtime/skillBuildClient';
import { getSkillCopy } from '../../game/skills/skillCopy';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

const classLabelKey = {
  MAGE: 'class.mage',
  WARRIOR: 'class.warrior',
  ARCHER: 'class.archer',
} as const;

const nodeKindLabel = (kind: SkillBuildNodePayload['kind'], polish: boolean): string => {
  const labels = polish
    ? { ACTIVE: 'Akcja', PASSIVE: 'Pasyw', MODIFIER: 'Modyfikator', KEYSTONE: 'Kluczowy talent' }
    : { ACTIVE: 'Action', PASSIVE: 'Passive', MODIFIER: 'Modifier', KEYSTONE: 'Keystone' };
  return labels[kind];
};

const fallbackLabel = (fallback: SkillFallbackAction, polish: boolean): string => {
  const labels = polish
    ? { DEFEND: 'Obrona', BASIC_ATTACK: 'Zwykły atak', SKIP: 'Pominięcie tury' }
    : { DEFEND: 'Defend', BASIC_ATTACK: 'Basic attack', SKIP: 'Skip turn' };
  return labels[fallback];
};

const unique = <T,>(values: readonly T[]): T[] => [...new Set(values)];

export function SkillModal({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { locale, t } = useI18n();
  const polish = locale === 'pl';
  const connection = useGameConnection();
  const tree = useGameState().skillTree as SkillBuildSnapshot | undefined;
  const [selectedSkillKey, setSelectedSkillKey] = useState('');
  const [selectedNodeKey, setSelectedNodeKey] = useState('');
  const [editingLoadoutId, setEditingLoadoutId] = useState<string>();
  const [loadoutName, setLoadoutName] = useState('');
  const [activeSkillKeys, setActiveSkillKeys] = useState<string[]>([]);
  const [passiveNodeKeys, setPassiveNodeKeys] = useState<string[]>([]);
  const [fallbackAction, setFallbackAction] = useState<SkillFallbackAction>('DEFEND');
  const [busy, setBusy] = useState<string>();

  useEffect(() => {
    if (!tree) void connection.getSkills();
  }, [connection, tree]);

  useEffect(() => {
    if (!tree) return;
    if (!selectedSkillKey || !tree.skills.some((skill) => skill.key === selectedSkillKey)) {
      setSelectedSkillKey(tree.activeLoadout?.activeSkillKeys[0] ?? tree.skills[0]?.key ?? '');
    }
    const virtualNodes = tree.nodes.filter((node) => node.kind !== 'ACTIVE');
    if (!selectedNodeKey || !virtualNodes.some((node) => node.key === selectedNodeKey)) {
      setSelectedNodeKey(virtualNodes[0]?.key ?? '');
    }
  }, [selectedNodeKey, selectedSkillKey, tree]);

  useEffect(() => {
    if (!tree) return;
    const loadout =
      tree.loadouts.find((candidate) => candidate.id === editingLoadoutId) ??
      tree.activeLoadout ??
      tree.loadouts[0];
    if (!loadout) return;
    setEditingLoadoutId(loadout.id);
    setLoadoutName(loadout.name);
    setActiveSkillKeys([...loadout.activeSkillKeys]);
    setPassiveNodeKeys([...loadout.passiveNodeKeys]);
    setFallbackAction(loadout.fallbackAction);
  }, [editingLoadoutId, tree]);

  const skillsByKey = useMemo(
    () => new Map(tree?.skills.map((skill) => [skill.key, skill]) ?? []),
    [tree],
  );
  const nodesByKey = useMemo(
    () => new Map(tree?.nodes.map((node) => [node.key, node]) ?? []),
    [tree],
  );
  const selectedSkill = skillsByKey.get(selectedSkillKey) ?? tree?.skills[0];
  const selectedNode = nodesByKey.get(selectedNodeKey);
  const selectedSpecialization = tree?.specializations.find((specialization) => specialization.selected);
  const specializationNodes = useMemo(
    () =>
      (tree?.nodes ?? []).filter(
        (node) =>
          node.kind !== 'ACTIVE' &&
          (!selectedSpecialization || node.specializationKey === selectedSpecialization.key),
      ),
    [selectedSpecialization, tree],
  );
  const passiveSpent = passiveNodeKeys.reduce((sum, key) => {
    const node = nodesByKey.get(key);
    return sum + (node?.passiveCost ?? 0) * (node?.rank ?? 0);
  }, 0);

  if (!tree || !selectedSkill) {
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

  const selectedCopy = getSkillCopy(selectedSkill.key, locale, selectedSkill);
  const missingNames = selectedSkill.missingPrerequisiteKeys.map((key) => {
    const prerequisite = skillsByKey.get(key);
    return prerequisite ? getSkillCopy(key, locale, prerequisite).name : key;
  });

  const rankUp = async (key: string): Promise<void> => {
    if (busy) return;
    setBusy(`rank:${key}`);
    try {
      await connection.unlockSkill(key);
    } finally {
      setBusy(undefined);
    }
  };

  const selectSpecialization = async (key: string): Promise<void> => {
    if (busy || tree.selectedSpecializationKey === key) return;
    const specialization = tree.specializations.find((candidate) => candidate.key === key);
    const accepted = window.confirm(
      polish
        ? `Wybrać specjalizację ${specialization?.name ?? key}? Po wydaniu punktów zmiana będzie wymagała respecu.`
        : `Choose ${specialization?.name ?? key}? After spending points, changing it will require a respec.`,
    );
    if (!accepted) return;
    setBusy(`spec:${key}`);
    try {
      await connection.selectSkillSpecialization(key, tree.version);
    } finally {
      setBusy(undefined);
    }
  };

  const toggleActive = (skill: SkillDefinitionPayload): void => {
    if (skill.rank < 1) return;
    setActiveSkillKeys((current) => {
      if (current.includes(skill.key)) return current.filter((key) => key !== skill.key);
      if (current.length >= tree.activeActionLimit) return current;
      return [...current, skill.key];
    });
  };

  const togglePassive = (node: SkillBuildNodePayload): void => {
    if (node.rank < 1) return;
    setPassiveNodeKeys((current) => {
      if (current.includes(node.key)) return current.filter((key) => key !== node.key);
      if (current.length >= tree.passiveSlotLimit) return current;
      const currentBudget = current.reduce((sum, key) => {
        const currentNode = nodesByKey.get(key);
        return sum + (currentNode?.passiveCost ?? 0) * (currentNode?.rank ?? 0);
      }, 0);
      const nextBudget = currentBudget + node.passiveCost * node.rank;
      if (nextBudget > tree.passiveBudget) return current;
      return [...current, node.key];
    });
  };

  const saveLoadout = async (asNew = false): Promise<void> => {
    if (busy) return;
    setBusy('save-loadout');
    try {
      const snapshot = await connection.saveSkillLoadout(
        {
          loadoutId: asNew ? undefined : editingLoadoutId,
          name: asNew
            ? `${loadoutName || (polish ? 'Zestaw' : 'Loadout')} ${tree.loadouts.length + 1}`
            : loadoutName,
          activeSkillKeys: unique(activeSkillKeys),
          passiveNodeKeys: unique(passiveNodeKeys),
          fallbackAction,
        },
        tree.version,
      );
      if (asNew) setEditingLoadoutId(snapshot.loadouts.at(-1)?.id);
    } finally {
      setBusy(undefined);
    }
  };

  const activateLoadout = async (loadout: SkillLoadoutDefinition): Promise<void> => {
    if (busy || !loadout.isValid || loadout.id === tree.activeLoadoutId) return;
    setBusy(`activate:${loadout.id}`);
    try {
      await connection.activateSkillLoadout(loadout.id, tree.version);
    } finally {
      setBusy(undefined);
    }
  };

  const resetBuild = async (): Promise<void> => {
    if (busy) return;
    const zeroRanks = Object.fromEntries(tree.nodes.map((node) => [node.key, 0]));
    setBusy('respec-preview');
    try {
      const preview = await connection.previewSkillRespec(undefined, zeroRanks);
      if (!preview.valid) return;
      const invalidText =
        preview.invalidLoadoutIds.length > 0
          ? polish
            ? `\n${preview.invalidLoadoutIds.length} zestawów zostanie oznaczonych jako nieprawidłowe.`
            : `\n${preview.invalidLoadoutIds.length} loadouts will be marked invalid.`
          : '';
      const accepted = window.confirm(
        polish
          ? `Zresetować cały build za ${preview.costSilver} srebra?${invalidText}`
          : `Reset the entire build for ${preview.costSilver} silver?${invalidText}`,
      );
      if (!accepted) return;
      setBusy('respec');
      await connection.respecSkills(undefined, zeroRanks, tree.version);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Modal
      title={t('modal.skills.title')}
      subtitle={`${t(classLabelKey[tree.characterClass])} · ${t('common.level')} ${tree.characterLevel} · build v${tree.version}`}
      icon="✦"
      onClose={onClose}
      widthClass="max-w-7xl"
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
          <span>{polish ? 'Wydane' : 'Spent'}</span>
          <strong>{tree.points.spent}</strong>
        </div>
        <p>
          {polish
            ? `Punkt co 5 poziomów. Akcje: maks. ${tree.activeActionLimit}. Pasywy: ${tree.passiveSlotLimit} sloty / budżet ${tree.passiveBudget}.`
            : `One point every 5 levels. Actions: max ${tree.activeActionLimit}. Passives: ${tree.passiveSlotLimit} slots / budget ${tree.passiveBudget}.`}
        </p>
      </div>

      <section className="mt-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-amber-200">
              {polish ? 'Specjalizacja' : 'Specialization'}
            </p>
            <h3 className="font-display text-2xl text-slate-50">
              {selectedSpecialization?.name ?? (polish ? 'Wybierz ścieżkę' : 'Choose a path')}
            </h3>
          </div>
          <Button
            disabled={Boolean(busy) || tree.points.spent === 0}
            busy={busy?.startsWith('respec')}
            onClick={() => void resetBuild()}
          >
            {tree.freeRespecAvailable
              ? polish
                ? 'Darmowy reset builda'
                : 'Free build reset'
              : polish
                ? `Reset: ${tree.respecCostSilver} srebra`
                : `Reset: ${tree.respecCostSilver} silver`}
          </Button>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          {tree.specializations.map((specialization) => (
            <button
              key={specialization.key}
              type="button"
              className={[
                'rounded-xl border p-4 text-left transition',
                specialization.selected
                  ? 'border-amber-300/60 bg-amber-300/10'
                  : 'border-white/10 bg-slate-950/35 hover:border-amber-300/30',
              ].join(' ')}
              disabled={Boolean(busy)}
              onClick={() => void selectSpecialization(specialization.key)}
            >
              <div className="flex items-center justify-between gap-2">
                <strong className="font-display text-xl text-slate-50">
                  {specialization.icon} {specialization.name}
                </strong>
                <span className="text-xs uppercase text-amber-200">{specialization.role}</span>
              </div>
              <p className="mt-2 text-sm text-slate-300">{specialization.promise}</p>
              <dl className="mt-3 space-y-2 text-xs text-slate-400">
                <div><dt className="text-slate-200">{polish ? 'Pętla solo' : 'Solo loop'}</dt><dd>{specialization.soloLoop}</dd></div>
                <div><dt className="text-slate-200">{polish ? 'Synergie grupowe' : 'Group synergies'}</dt><dd>{specialization.groupSynergies.join(' · ')}</dd></div>
                <div><dt className="text-slate-200">{polish ? 'Odpowiedź na zagrożenie' : 'Threat response'}</dt><dd>{specialization.threatResponse}</dd></div>
                <div><dt className="text-rose-200">{polish ? 'Koszt wyboru' : 'Drawback'}</dt><dd>{specialization.drawback}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-amber-100">
                {polish ? 'Punkty w ścieżce' : 'Points in path'}: {specialization.spentPoints}
              </p>
            </button>
          ))}
        </div>
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <div className="space-y-5">
          <section>
            <h3 className="font-display text-xl text-slate-100">
              {polish ? 'Aktywne umiejętności i rangi' : 'Active skills and ranks'}
            </h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {tree.skills.map((skill) => {
                const copy = getSkillCopy(skill.key, locale, skill);
                const inDraft = activeSkillKeys.includes(skill.key);
                return (
                  <div
                    key={skill.key}
                    className={[
                      'rounded-lg border p-3',
                      skill.key === selectedSkill.key
                        ? 'border-amber-300/60 bg-amber-300/10'
                        : 'border-white/10 bg-slate-950/35',
                    ].join(' ')}
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => setSelectedSkillKey(skill.key)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <strong className="text-sm text-slate-100">{skill.icon} {copy.name}</strong>
                        <span className="text-xs text-amber-200">{skill.rank}/{skill.maxRank}</span>
                      </div>
                      <p className="mt-2 text-xs text-slate-400">
                        {skill.energyCost} EN · CD {skill.cooldownTurns} · {skill.targeting}
                      </p>
                    </button>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        disabled={Boolean(busy) || skill.unlockState !== 'AVAILABLE'}
                        busy={busy === `rank:${skill.key}`}
                        onClick={() => void rankUp(skill.key)}
                      >
                        {polish ? 'Ranga +' : 'Rank +'}
                      </Button>
                      <button
                        type="button"
                        className={[
                          'rounded border px-2 py-1 text-xs',
                          inDraft
                            ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-200'
                            : 'border-white/10 text-slate-400',
                        ].join(' ')}
                        disabled={skill.rank < 1}
                        onClick={() => toggleActive(skill)}
                      >
                        {inDraft ? (polish ? 'W zestawie' : 'Equipped') : (polish ? 'Dodaj' : 'Add')}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          <section>
            <h3 className="font-display text-xl text-slate-100">
              {polish ? 'Talenty specjalizacji' : 'Specialization talents'}
            </h3>
            {!selectedSpecialization ? (
              <p className="mt-3 rounded-lg border border-dashed border-white/10 p-5 text-sm text-slate-400">
                {polish ? 'Najpierw wybierz specjalizację.' : 'Choose a specialization first.'}
              </p>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {specializationNodes.map((node) => {
                  const selected = node.key === selectedNode?.key;
                  const equipped = passiveNodeKeys.includes(node.key);
                  return (
                    <div
                      key={node.key}
                      className={[
                        'rounded-lg border p-3',
                        selected
                          ? 'border-amber-300/60 bg-amber-300/10'
                          : 'border-white/10 bg-slate-950/35',
                      ].join(' ')}
                    >
                      <button type="button" className="w-full text-left" onClick={() => setSelectedNodeKey(node.key)}>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <span className="text-xs uppercase text-amber-200">{nodeKindLabel(node.kind, polish)}</span>
                            <strong className="mt-1 block text-sm text-slate-100">{node.icon} {node.name}</strong>
                          </div>
                          <span className="text-xs text-amber-200">{node.rank}/{node.maxRank}</span>
                        </div>
                        <p className="mt-2 text-xs text-slate-400">{node.description}</p>
                        <p className="mt-2 text-xs text-slate-500">
                          {polish ? 'Koszt' : 'Cost'}: {node.pointCost} pkt · {polish ? 'budżet pasywny' : 'passive budget'}: {node.passiveCost * Math.max(1, node.rank)}
                        </p>
                        {node.choiceGroupKey ? (
                          <p className="mt-1 text-xs text-rose-200">
                            {polish ? 'Wybór wykluczający' : 'Mutually exclusive choice'}
                          </p>
                        ) : null}
                      </button>
                      {node.blockedReasons.length > 0 && node.rank < node.maxRank ? (
                        <p className="mt-2 text-xs text-rose-300">{node.blockedReasons.join(' · ')}</p>
                      ) : null}
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          disabled={Boolean(busy) || !node.available}
                          busy={busy === `rank:${node.key}`}
                          onClick={() => void rankUp(node.key)}
                        >
                          {polish ? 'Ranga +' : 'Rank +'}
                        </Button>
                        <button
                          type="button"
                          className={[
                            'rounded border px-2 py-1 text-xs',
                            equipped
                              ? 'border-emerald-300/50 bg-emerald-400/10 text-emerald-200'
                              : 'border-white/10 text-slate-400',
                          ].join(' ')}
                          disabled={node.rank < 1}
                          onClick={() => togglePassive(node)}
                        >
                          {equipped ? (polish ? 'Aktywny' : 'Slotted') : (polish ? 'Do slotu' : 'Slot')}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-4">
          <section className="skill-detail">
            <div className="skill-detail-icon" style={{ color: selectedSkill.visual.accentColor }}>
              {selectedSkill.icon}
            </div>
            <p className="skill-detail-state">
              {polish ? 'Podgląd skutku builda' : 'Build impact preview'}
            </p>
            <h3>{selectedCopy.name}</h3>
            <p className="skill-detail-description">{selectedCopy.description}</p>
            <dl className="skill-detail-stats">
              <div>
                <dt>{t('modal.skills.energy')}</dt>
                <dd>
                  {selectedSkill.baseImpact.energyCost === selectedSkill.energyCost
                    ? selectedSkill.energyCost
                    : `${selectedSkill.baseImpact.energyCost} → ${selectedSkill.energyCost}`}
                </dd>
              </div>
              <div>
                <dt>{t('modal.skills.cooldown')}</dt>
                <dd>
                  {selectedSkill.baseImpact.cooldownTurns === selectedSkill.cooldownTurns
                    ? selectedSkill.cooldownTurns
                    : `${selectedSkill.baseImpact.cooldownTurns} → ${selectedSkill.cooldownTurns}`}
                </dd>
              </div>
              <div>
                <dt>{t('modal.skills.target')}</dt>
                <dd>
                  {selectedSkill.baseImpact.targeting === selectedSkill.targeting
                    ? selectedSkill.targeting
                    : `${selectedSkill.baseImpact.targeting} → ${selectedSkill.targeting}`}
                </dd>
              </div>
              <div><dt>{polish ? 'Ranga' : 'Rank'}</dt><dd>{selectedSkill.rank}/{selectedSkill.maxRank}</dd></div>
            </dl>
            {missingNames.length > 0 ? (
              <p className="skill-requirement">{t('modal.skills.requires')}: {missingNames.join(', ')}</p>
            ) : null}
            {selectedNode ? (
              <div className="mt-4 rounded-lg border border-white/10 bg-slate-950/35 p-3 text-xs text-slate-300">
                <strong>{selectedNode.name}</strong>
                <p className="mt-1">{selectedNode.description}</p>
                <p className="mt-2 text-slate-500">
                  {polish ? 'Wymagania' : 'Requirements'}: {selectedNode.prerequisiteKeys.join(', ') || '—'}
                </p>
              </div>
            ) : null}
          </section>

          <section className="rounded-xl border border-white/10 bg-slate-950/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-amber-200">
                  {polish ? 'Loadout' : 'Loadout'}
                </p>
                <h3 className="font-display text-xl text-slate-50">
                  {tree.activeLoadout?.name ?? (polish ? 'Brak aktywnego' : 'No active loadout')}
                </h3>
              </div>
              <span className="text-xs text-slate-400">
                {activeSkillKeys.length}/{tree.activeActionLimit} · {passiveNodeKeys.length}/{tree.passiveSlotLimit}
              </span>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {tree.loadouts.map((loadout) => (
                <button
                  key={loadout.id}
                  type="button"
                  className={[
                    'rounded border px-2 py-1 text-xs',
                    loadout.id === editingLoadoutId
                      ? 'border-amber-300/60 text-amber-100'
                      : 'border-white/10 text-slate-400',
                    !loadout.isValid ? 'line-through opacity-70' : '',
                  ].join(' ')}
                  onClick={() => setEditingLoadoutId(loadout.id)}
                >
                  {loadout.name}{loadout.id === tree.activeLoadoutId ? ' ●' : ''}
                </button>
              ))}
            </div>

            <label className="mt-4 block text-xs text-slate-400">
              {polish ? 'Nazwa' : 'Name'}
              <input
                value={loadoutName}
                maxLength={32}
                onChange={(event) => setLoadoutName(event.target.value)}
                className="mt-1 w-full rounded border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              />
            </label>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {Array.from({ length: tree.activeActionLimit }, (_, index) => {
                const key = activeSkillKeys[index];
                const skill = key ? skillsByKey.get(key) : undefined;
                return (
                  <button
                    key={index}
                    type="button"
                    className="min-h-14 rounded border border-white/10 bg-slate-950/50 p-2 text-xs text-slate-300"
                    onClick={() => key && setActiveSkillKeys((current) => current.filter((entry) => entry !== key))}
                  >
                    {skill ? `${index + 1}. ${skill.icon} ${getSkillCopy(skill.key, locale, skill).name}` : `${index + 1}. —`}
                  </button>
                );
              })}
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {passiveNodeKeys.length === 0 ? (
                <span className="text-xs text-slate-500">{polish ? 'Brak pasywów' : 'No passives'}</span>
              ) : (
                passiveNodeKeys.map((key) => (
                  <button
                    key={key}
                    type="button"
                    className="rounded border border-emerald-300/30 bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200"
                    onClick={() => setPassiveNodeKeys((current) => current.filter((entry) => entry !== key))}
                  >
                    {nodesByKey.get(key)?.name ?? key} ×
                  </button>
                ))
              )}
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {polish ? 'Budżet pasywny' : 'Passive budget'}: {passiveSpent}/{tree.passiveBudget}
            </p>

            <label className="mt-3 block text-xs text-slate-400">
              {polish ? 'Akcja awaryjna' : 'Fallback action'}
              <select
                value={fallbackAction}
                onChange={(event) => setFallbackAction(event.target.value as SkillFallbackAction)}
                className="mt-1 w-full rounded border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100"
              >
                {(['DEFEND', 'BASIC_ATTACK', 'SKIP'] as const).map((fallback) => (
                  <option key={fallback} value={fallback}>{fallbackLabel(fallback, polish)}</option>
                ))}
              </select>
            </label>

            {tree.loadouts.find((loadout) => loadout.id === editingLoadoutId)?.isValid === false ? (
              <p className="mt-3 rounded border border-rose-300/20 bg-rose-400/10 p-2 text-xs text-rose-200">
                {polish ? 'Zestaw jest wyłączony: ' : 'Loadout disabled: '}
                {tree.loadouts.find((loadout) => loadout.id === editingLoadoutId)?.invalidReasons.join(', ')}
              </p>
            ) : null}

            <div className="mt-4 grid grid-cols-3 gap-2">
              <Button busy={busy === 'save-loadout'} disabled={Boolean(busy)} onClick={() => void saveLoadout(false)}>
                {polish ? 'Zapisz' : 'Save'}
              </Button>
              <Button busy={busy === 'save-loadout'} disabled={Boolean(busy) || tree.loadouts.length >= 5} onClick={() => void saveLoadout(true)}>
                {polish ? 'Kopia' : 'Save copy'}
              </Button>
              <Button
                busy={busy?.startsWith('activate:')}
                disabled={Boolean(busy) || editingLoadoutId === tree.activeLoadoutId || tree.loadouts.find((loadout) => loadout.id === editingLoadoutId)?.isValid === false}
                onClick={() => {
                  const loadout = tree.loadouts.find((candidate) => candidate.id === editingLoadoutId);
                  if (loadout) void activateLoadout(loadout);
                }}
              >
                {polish ? 'Aktywuj' : 'Activate'}
              </Button>
            </div>
            <p className="mt-3 text-xs text-slate-500">
              {polish
                ? 'Zapis i aktywację serwer blokuje podczas walki i handlu. Nieprawidłowy zestaw nigdy nie jest automatycznie naprawiany.'
                : 'The server blocks saving and activation during combat and trade. Invalid loadouts are never silently repaired.'}
            </p>
          </section>
        </aside>
      </div>
    </Modal>
  );
}
