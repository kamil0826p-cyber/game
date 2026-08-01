import { useEffect, useState } from 'react';
import { OutfitPreview } from '../../components/common/OutfitPreview';
import type { SelfCharacterState } from '../../contracts/game';
import {
  PROGRESSION_NODE_KEYS,
  type ProgressionNodeKey,
  type ProgressionSnapshot,
  type ProgressionStatVector,
} from '../../contracts/progression';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import {
  chooseProgression,
  getProgression,
  respecProgression,
} from '../../game/realtime/progressionClient';
import { useI18n } from '../../i18n/I18nProvider';
import { Modal } from './Modal';

const classLabelKey = {
  MAGE: 'class.mage',
  WARRIOR: 'class.warrior',
  ARCHER: 'class.archer',
} as const;

const classDescriptionKey = {
  MAGE: 'class.mageDescription',
  WARRIOR: 'class.warriorDescription',
  ARCHER: 'class.archerDescription',
} as const;

const nodeCopy: Record<ProgressionNodeKey, { name: string; description: string }> = {
  ENDURANCE: { name: 'Endurance', description: '+34 HP and +1 armor per rank' },
  PRECISION: { name: 'Precision', description: '+1 strength and +2 agility per rank' },
  RITUAL_KNOWLEDGE: { name: 'Ritual knowledge', description: '+16 energy and +2 intelligence per rank' },
  MOBILITY: { name: 'Mobility', description: '+9 energy and +1 agility per rank' },
  CONTROL: { name: 'Control', description: '+14 HP, +1 intelligence and +1 armor per rank' },
};

const statRows: Array<{ key: keyof ProgressionStatVector; label: string }> = [
  { key: 'maxHp', label: 'Max HP' },
  { key: 'maxEnergy', label: 'Max energy' },
  { key: 'strength', label: 'Strength' },
  { key: 'agility', label: 'Agility' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'armor', label: 'Armor' },
];

const sourceColumns: Array<{ key: keyof ProgressionSnapshot['sources']; label: string }> = [
  { key: 'base', label: 'Base' },
  { key: 'automaticProgression', label: 'Level' },
  { key: 'milestoneChoices', label: 'Choices' },
  { key: 'legacyAdjustment', label: 'Legacy' },
  { key: 'equipment', label: 'Equipment' },
  { key: 'temporary', label: 'Effects' },
];

export function CharacterModal({ character, onClose }: { character: SelfCharacterState; onClose: () => void }): React.JSX.Element {
  const { t } = useI18n();
  const connection = useGameConnection();
  const [progression, setProgression] = useState<ProgressionSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    setError(undefined);
    void getProgression(connection)
      .then((snapshot) => { if (active) setProgression(snapshot); })
      .catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, [connection, character.characterId]);

  const synchronizeMutation = async (snapshot: ProgressionSnapshot): Promise<void> => {
    setProgression(snapshot);
    await connection.getInventory();
  };

  const choose = async (nodeKey: ProgressionNodeKey) => {
    setBusy(true);
    setError(undefined);
    try {
      await synchronizeMutation(await chooseProgression(connection, nodeKey));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const respec = async () => {
    if (!progression) return;
    setBusy(true);
    setError(undefined);
    try {
      await synchronizeMutation(await respecProgression(connection));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('modal.character.title')} subtitle="Canonical stats and milestone choices" icon="◆" onClose={onClose}>
      <div className="grid gap-5 lg:grid-cols-[180px_1fr]">
        <div className="character-pedestal min-h-56">
          <OutfitPreview outfitKey={character.outfitKey} characterClass={character.characterClass} />
        </div>
        <div>
          <h3 className="font-display text-3xl text-slate-50">{character.name}</h3>
          <p className="mt-1 text-sm uppercase tracking-[0.18em] text-amber-200">
            {t('common.level')} {character.level} {t(classLabelKey[character.characterClass])}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-400">{t(classDescriptionKey[character.characterClass])}</p>
          {!progression ? (
            <p className="mt-5 text-sm text-slate-300">{error ?? 'Loading stat sources…'}</p>
          ) : (
            <>
              <div className="mt-5 overflow-x-auto rounded border border-amber-200/20 bg-slate-950/40">
                <table className="w-full min-w-[680px] text-right text-xs">
                  <thead className="text-amber-200">
                    <tr>
                      <th className="p-2 text-left">Stat</th>
                      {sourceColumns.map((source) => <th key={source.key} className="p-2">{source.label}</th>)}
                      <th className="p-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statRows.map((stat) => (
                      <tr key={stat.key} className="border-t border-slate-700/60">
                        <td className="p-2 text-left text-slate-200">{stat.label}</td>
                        {sourceColumns.map((source) => (
                          <td key={source.key} className="p-2 text-slate-400">{progression.sources[source.key][stat.key]}</td>
                        ))}
                        <td className="p-2 font-semibold text-slate-50">{progression.effective[stat.key]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="stat-tile"><span>Physical power</span><strong>{progression.derived.physicalPower}</strong></div>
                <div className="stat-tile"><span>Spell power</span><strong>{progression.derived.spellPower}</strong></div>
                <div className="stat-tile"><span>Damage reduction</span><strong>{(progression.derived.damageReductionBasisPoints / 100).toFixed(1)}%</strong></div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-400">{progression.limits.explanation}</p>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-display text-xl text-amber-100">Milestone choices</h4>
                  <p className="text-sm text-slate-400">
                    {progression.points.available} available / {progression.points.earned} earned
                    {progression.points.nextPointAtLevel ? ` · next at level ${progression.points.nextPointAtLevel}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="retro-button border-rose-300/60 bg-rose-500/10 text-rose-100 disabled:opacity-40"
                  disabled={busy || progression.choices.length === 0 || !progression.respec.allowed}
                  onClick={() => void respec()}
                >
                  Reset build · {progression.respec.silverCost === 0 ? 'free' : `${progression.respec.silverCost} silver`}
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {PROGRESSION_NODE_KEYS.map((nodeKey) => {
                  const rank = progression.nodeRanks[nodeKey];
                  return (
                    <button
                      key={nodeKey}
                      type="button"
                      disabled={busy || progression.points.available < 1 || rank >= 8}
                      onClick={() => void choose(nodeKey)}
                      className="rounded border border-amber-200/25 bg-slate-900/70 p-3 text-left transition hover:border-amber-200/60 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className="font-display text-lg text-amber-100">{nodeCopy[nodeKey].name} · {rank}/8</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-400">{nodeCopy[nodeKey].description}</span>
                    </button>
                  );
                })}
              </div>
              {error ? <p className="mt-3 text-sm text-rose-200">{error}</p> : null}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
