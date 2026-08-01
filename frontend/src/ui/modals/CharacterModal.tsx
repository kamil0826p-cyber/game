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

const nodeNames: Record<'en' | 'pl', Record<ProgressionNodeKey, string>> = {
  en: {
    ENDURANCE: 'Endurance',
    PRECISION: 'Precision',
    RITUAL_KNOWLEDGE: 'Ritual knowledge',
    MOBILITY: 'Mobility',
    CONTROL: 'Control',
  },
  pl: {
    ENDURANCE: 'Wytrzymałość',
    PRECISION: 'Precyzja',
    RITUAL_KNOWLEDGE: 'Wiedza rytualna',
    MOBILITY: 'Mobilność',
    CONTROL: 'Kontrola',
  },
};

const labels = {
  en: {
    subtitle: 'Canonical stats and milestone choices', loading: 'Loading stat sources…', stat: 'Stat', total: 'Total',
    sources: ['Base', 'Level', 'Choices', 'Legacy', 'Equipment', 'Effects'],
    stats: ['Max HP', 'Max energy', 'Strength', 'Agility', 'Intelligence', 'Armor'],
    bonusStats: { maxHp: 'HP', maxEnergy: 'energy', strength: 'strength', agility: 'agility', intelligence: 'intelligence', armor: 'armor' },
    physical: 'Physical power', spell: 'Spell power', reduction: 'Damage reduction',
    choices: 'Milestone choices', available: 'available', earned: 'earned', next: 'next at level',
    reset: 'Reset build', free: 'free', silver: 'silver', perRank: 'per rank',
  },
  pl: {
    subtitle: 'Kanoniczne statystyki i wybory rozwoju', loading: 'Wczytywanie źródeł statystyk…', stat: 'Statystyka', total: 'Suma',
    sources: ['Baza', 'Poziom', 'Wybory', 'Migracja', 'Ekwipunek', 'Efekty'],
    stats: ['Maks. PŻ', 'Maks. energia', 'Siła', 'Zręczność', 'Inteligencja', 'Pancerz'],
    bonusStats: { maxHp: 'PŻ', maxEnergy: 'energii', strength: 'siły', agility: 'zręczności', intelligence: 'inteligencji', armor: 'pancerza' },
    physical: 'Moc fizyczna', spell: 'Moc magiczna', reduction: 'Redukcja obrażeń',
    choices: 'Wybory kamieni milowych', available: 'dostępne', earned: 'zdobyte', next: 'następny na poziomie',
    reset: 'Zresetuj build', free: 'bezpłatnie', silver: 'srebra', perRank: 'na rangę',
  },
} as const;

const statKeys: Array<keyof ProgressionStatVector> = ['maxHp', 'maxEnergy', 'strength', 'agility', 'intelligence', 'armor'];
const sourceKeys: Array<keyof ProgressionSnapshot['sources']> = ['base', 'automaticProgression', 'milestoneChoices', 'legacyAdjustment', 'equipment', 'temporary'];

function formatBonuses(vector: ProgressionStatVector, locale: 'en' | 'pl'): string {
  const copy = labels[locale];
  return statKeys
    .filter((stat) => vector[stat] !== 0)
    .map((stat) => `${vector[stat] > 0 ? '+' : ''}${vector[stat]} ${copy.bonusStats[stat]}`)
    .join(', ');
}

function capExplanation(progression: ProgressionSnapshot, locale: 'en' | 'pl'): string {
  const limits = progression.limits;
  return locale === 'pl'
    ? `Pokazane atrybuty są sumą autorytatywnych źródeł. Statystyki główne mają próg ${limits.primarySoftCap} i limit efektywny ${limits.primaryHardCap}; pancerz ma próg ${limits.armorSoftCap} i limit efektywny ${limits.armorHardCap}.`
    : `Displayed attributes are the sum of authoritative sources. Primary stats have a ${limits.primarySoftCap} soft cap and ${limits.primaryHardCap} effective cap; armor has a ${limits.armorSoftCap} soft cap and ${limits.armorHardCap} effective cap.`;
}

export function CharacterModal({ character, onClose }: { character: SelfCharacterState; onClose: () => void }): React.JSX.Element {
  const { locale, t } = useI18n();
  const copy = labels[locale];
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
    <Modal title={t('modal.character.title')} subtitle={copy.subtitle} icon="◆" onClose={onClose}>
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
            <p className="mt-5 text-sm text-slate-300">{error ?? copy.loading}</p>
          ) : (
            <>
              <div className="mt-5 overflow-x-auto rounded border border-amber-200/20 bg-slate-950/40">
                <table className="w-full min-w-[680px] text-right text-xs">
                  <thead className="text-amber-200">
                    <tr>
                      <th className="p-2 text-left">{copy.stat}</th>
                      {sourceKeys.map((source, index) => <th key={source} className="p-2">{copy.sources[index]}</th>)}
                      <th className="p-2">{copy.total}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statKeys.map((stat, statIndex) => (
                      <tr key={stat} className="border-t border-slate-700/60">
                        <td className="p-2 text-left text-slate-200">{copy.stats[statIndex]}</td>
                        {sourceKeys.map((source) => (
                          <td key={source} className="p-2 text-slate-400">{progression.sources[source][stat]}</td>
                        ))}
                        <td className="p-2 font-semibold text-slate-50">{progression.effective[stat]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="stat-tile"><span>{copy.physical}</span><strong>{progression.derived.physicalPower}</strong></div>
                <div className="stat-tile"><span>{copy.spell}</span><strong>{progression.derived.spellPower}</strong></div>
                <div className="stat-tile"><span>{copy.reduction}</span><strong>{(progression.derived.damageReductionBasisPoints / 100).toFixed(1)}%</strong></div>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-400">{capExplanation(progression, locale)}</p>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="font-display text-xl text-amber-100">{copy.choices}</h4>
                  <p className="text-sm text-slate-400">
                    {progression.points.available} {copy.available} / {progression.points.earned} {copy.earned}
                    {progression.points.nextPointAtLevel ? ` · ${copy.next} ${progression.points.nextPointAtLevel}` : ''}
                  </p>
                </div>
                <button
                  type="button"
                  className="retro-button border-rose-300/60 bg-rose-500/10 text-rose-100 disabled:opacity-40"
                  disabled={busy || progression.choices.length === 0 || !progression.respec.allowed}
                  onClick={() => void respec()}
                >
                  {copy.reset} · {progression.respec.silverCost === 0 ? copy.free : `${progression.respec.silverCost} ${copy.silver}`}
                </button>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {PROGRESSION_NODE_KEYS.map((nodeKey) => {
                  const rank = progression.nodeRanks[nodeKey];
                  const definition = progression.nodes[nodeKey];
                  return (
                    <button
                      key={nodeKey}
                      type="button"
                      disabled={busy || progression.points.available < 1 || rank >= definition.maxRank}
                      onClick={() => void choose(nodeKey)}
                      className="rounded border border-amber-200/25 bg-slate-900/70 p-3 text-left transition hover:border-amber-200/60 disabled:cursor-not-allowed disabled:opacity-45"
                    >
                      <span className="font-display text-lg text-amber-100">{nodeNames[locale][nodeKey]} · {rank}/{definition.maxRank}</span>
                      <span className="mt-1 block text-xs leading-5 text-slate-400">
                        {formatBonuses(definition.bonusesPerRank, locale)} {copy.perRank}
                      </span>
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
