import { useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/common/Button';
import { OutfitPreview } from '../../components/common/OutfitPreview';
import type { SelfCharacterState } from '../../contracts/game';
import type {
  CharacterProgressionSnapshot,
  ProgressionStatKey,
  ProgressionStatVector,
} from '../../contracts/progression';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
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

const statKeys: readonly ProgressionStatKey[] = [
  'maxHp',
  'maxEnergy',
  'strength',
  'agility',
  'intelligence',
  'armor',
];

const statLabel = (key: ProgressionStatKey, polish: boolean): string => {
  const labels = polish
    ? {
        maxHp: 'Maks. HP',
        maxEnergy: 'Maks. energia',
        strength: 'Siła',
        agility: 'Zręczność',
        intelligence: 'Inteligencja',
        armor: 'Pancerz',
      }
    : {
        maxHp: 'Max HP',
        maxEnergy: 'Max energy',
        strength: 'Strength',
        agility: 'Agility',
        intelligence: 'Intelligence',
        armor: 'Armor',
      };
  return labels[key];
};

const nonZeroEntries = (
  vector: ProgressionStatVector,
): Array<[ProgressionStatKey, number]> => {
  const entries: Array<[ProgressionStatKey, number]> = [];
  for (const key of statKeys) {
    if (vector[key] !== 0) entries.push([key, vector[key]]);
  }
  return entries;
};

export function CharacterModal({
  character,
  onClose,
}: {
  character: SelfCharacterState;
  onClose: () => void;
}): React.JSX.Element {
  const { locale, t } = useI18n();
  const connection = useGameConnection();
  const polish = locale === 'pl';
  const [progression, setProgression] = useState<CharacterProgressionSnapshot>();
  const [busyKey, setBusyKey] = useState<string>();
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    void connection
      .getCharacterProgression()
      .then((snapshot) => {
        if (active) setProgression(snapshot);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [connection]);

  const attributes = [
    [t('modal.character.strength'), character.strength],
    [t('modal.character.agility'), character.agility],
    [t('modal.character.intelligence'), character.intelligence],
    [t('modal.character.armor'), character.armor],
  ] as const;

  const sourceCards = useMemo(() => {
    if (!progression) return [];
    return [
      [polish ? 'Baza klasy' : 'Class base', progression.sources.base],
      [polish ? 'Krzywa poziomu' : 'Level curve', progression.sources.levels],
      [polish ? 'Kamienie milowe' : 'Milestones', progression.sources.milestones],
      [polish ? 'Ekwipunek' : 'Equipment', progression.sources.equipment],
      [polish ? 'Stałe źródła' : 'Permanent sources', progression.sources.permanent],
      [polish ? 'Efekty tymczasowe' : 'Temporary effects', progression.sources.temporary],
      [polish ? 'Korekta legacy' : 'Legacy adjustment', progression.sources.legacyAdjustment],
    ] as const;
  }, [polish, progression]);

  const allocate = async (
    milestoneKey: CharacterProgressionSnapshot['milestones'][number]['key'],
  ) => {
    if (busyKey) return;
    setBusyKey(milestoneKey);
    try {
      setProgression(await connection.allocateCharacterMilestone(milestoneKey));
    } catch {
      // The socket bridge already surfaces the localized server error.
    } finally {
      setBusyKey(undefined);
    }
  };

  const respec = async (): Promise<void> => {
    if (busyKey || !progression || progression.points.spent === 0) return;
    setBusyKey('respec');
    try {
      setProgression(await connection.respecCharacterMilestones());
    } catch {
      // The socket bridge already surfaces the localized server error.
    } finally {
      setBusyKey(undefined);
    }
  };

  return (
    <Modal
      title={t('modal.character.title')}
      subtitle={t('modal.character.subtitle')}
      icon="◆"
      onClose={onClose}
      widthClass="max-w-6xl"
    >
      <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
        <div className="character-pedestal min-h-56">
          <OutfitPreview
            outfitKey={character.outfitKey}
            characterClass={character.characterClass}
          />
        </div>
        <div>
          <h3 className="font-display text-3xl text-slate-50">{character.name}</h3>
          <p className="mt-1 text-sm uppercase tracking-[0.18em] text-amber-200">
            {t('common.level')} {character.level} {t(classLabelKey[character.characterClass])}
          </p>
          <p className="mt-3 text-sm leading-6 text-slate-400">
            {t(classDescriptionKey[character.characterClass])}
          </p>
          <div className="mt-5 grid grid-cols-2 gap-3">
            {attributes.map(([label, value]) => (
              <div key={label} className="stat-tile">
                <span>{label}</span>
                <strong>{value}</strong>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!progression ? (
        <p className="mt-6 py-8 text-center text-sm text-slate-400">
          {loadFailed
            ? polish
              ? 'Nie udało się pobrać progresji postaci.'
              : 'Character progression could not be loaded.'
            : `${t('common.loading')}…`}
        </p>
      ) : (
        <div className="mt-6 space-y-5">
          <section className="rounded-xl border border-amber-300/20 bg-slate-950/40 p-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-amber-200">
                  {polish ? 'Kanoniczna progresja' : 'Canonical progression'}
                </p>
                <h4 className="mt-1 font-display text-2xl text-slate-50">
                  {polish ? 'Punkty kamieni milowych' : 'Milestone points'}
                </h4>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center text-sm">
                <div className="stat-tile min-w-20">
                  <span>{polish ? 'Zdobyte' : 'Earned'}</span>
                  <strong>{progression.points.earned}</strong>
                </div>
                <div className="stat-tile min-w-20">
                  <span>{polish ? 'Wydane' : 'Spent'}</span>
                  <strong>{progression.points.spent}</strong>
                </div>
                <div className="stat-tile min-w-20">
                  <span>{polish ? 'Dostępne' : 'Available'}</span>
                  <strong>{progression.points.available}</strong>
                </div>
              </div>
            </div>
            <p className="mt-3 text-xs text-slate-400">
              {polish
                ? `Reguły v${progression.rulesVersion}, krzywe klas v${progression.classCurveVersion}, zachowanie zasobów: proporcja HP/energii.`
                : `Rules v${progression.rulesVersion}, class curves v${progression.classCurveVersion}, resources preserve the HP/energy ratio.`}
            </p>
          </section>

          <section>
            <h4 className="font-display text-xl text-slate-100">
              {polish ? 'Rozbicie statystyk' : 'Stat breakdown'}
            </h4>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {sourceCards.map(([label, vector]) => {
                const entries = nonZeroEntries(vector);
                return (
                  <div
                    key={label}
                    className="rounded-lg border border-white/10 bg-slate-950/35 p-3"
                  >
                    <strong className="text-sm text-amber-100">{label}</strong>
                    {entries.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">—</p>
                    ) : (
                      <dl className="mt-2 space-y-1 text-xs text-slate-300">
                        {entries.map(([key, value]) => (
                          <div key={key} className="flex justify-between gap-3">
                            <dt>{statLabel(key, polish)}</dt>
                            <dd
                              className={
                                value >= 0 ? 'text-emerald-300' : 'text-rose-300'
                              }
                            >
                              {value >= 0 ? '+' : ''}
                              {value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-xl border border-white/10 bg-slate-950/35 p-4">
              <h4 className="font-display text-xl text-slate-100">
                {polish ? 'Statystyki efektywne' : 'Effective stats'}
              </h4>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {statKeys.map((key) => (
                  <div key={key} className="stat-tile">
                    <span>{statLabel(key, polish)}</span>
                    <strong>{progression.effective[key]}</strong>
                  </div>
                ))}
              </dl>
            </div>
            <div className="rounded-xl border border-white/10 bg-slate-950/35 p-4">
              <h4 className="font-display text-xl text-slate-100">
                {polish ? 'Wartości pochodne' : 'Derived values'}
              </h4>
              <dl className="mt-3 space-y-2 text-sm text-slate-300">
                <div className="flex justify-between">
                  <dt>
                    {polish ? 'Redukcja obrażeń pancerza' : 'Armor damage reduction'}
                  </dt>
                  <dd>
                    {Math.round(progression.derived.armorDamageReduction * 1000) / 10}%
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt>{polish ? 'Inicjatywa' : 'Initiative'}</dt>
                  <dd>{progression.derived.initiative}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{polish ? 'Unik' : 'Dodge'}</dt>
                  <dd>{Math.round(progression.derived.dodgeChance * 1000) / 10}%</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{polish ? 'Siła kontroli' : 'Control power'}</dt>
                  <dd>{progression.derived.controlPower}</dd>
                </div>
                <div className="flex justify-between">
                  <dt>{polish ? 'Odporność na kontrolę' : 'Control resistance'}</dt>
                  <dd>{progression.derived.controlResistance}</dd>
                </div>
              </dl>
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h4 className="font-display text-xl text-slate-100">
                {polish ? 'Kamienie milowe' : 'Milestones'}
              </h4>
              <Button
                busy={busyKey === 'respec'}
                disabled={Boolean(busyKey) || progression.points.spent === 0}
                onClick={() => void respec()}
              >
                {progression.respec.freeAvailable
                  ? polish
                    ? 'Darmowy reset'
                    : 'Free respec'
                  : `${polish ? 'Reset' : 'Respec'} · ${progression.respec.costSilver} silver`}
              </Button>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {progression.milestones.map((milestone) => {
                const preview = nonZeroEntries(milestone.previewEffectiveDelta);
                return (
                  <article
                    key={milestone.key}
                    className="rounded-xl border border-white/10 bg-slate-950/35 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h5 className="font-semibold text-slate-100">{milestone.name}</h5>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          {milestone.description}
                        </p>
                      </div>
                      <span className="rounded-full border border-amber-300/25 px-2 py-1 text-xs text-amber-100">
                        {milestone.currentRank}/{milestone.maxRank}
                      </span>
                    </div>
                    <p className="mt-3 min-h-5 text-xs text-emerald-300">
                      {preview.length > 0
                        ? preview
                            .map(
                              ([key, value]) => `${statLabel(key, polish)} +${value}`,
                            )
                            .join(' · ')
                        : milestone.blockedReason ?? '—'}
                    </p>
                    <Button
                      className="mt-3 w-full"
                      busy={busyKey === milestone.key}
                      disabled={Boolean(busyKey) || !milestone.canAllocate}
                      onClick={() => void allocate(milestone.key)}
                    >
                      {polish ? 'Dodaj punkt' : 'Allocate point'}
                    </Button>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-white/10 bg-slate-950/35 p-4">
            <h4 className="font-display text-lg text-slate-100">
              {polish ? 'Jawne soft capy' : 'Visible soft caps'}
            </h4>
            <div className="mt-2 grid gap-2 text-xs text-slate-400 md:grid-cols-2">
              {progression.softCaps.map((cap) => (
                <p key={cap.key}>
                  <strong className="text-slate-200">{cap.key}</strong>:{' '}
                  {cap.firstThreshold} / {cap.secondThreshold};{' '}
                  {Math.round(cap.middleRate * 100)}% /{' '}
                  {Math.round(cap.highRate * 100)}%{' '}
                  {polish
                    ? 'skuteczności kolejnych punktów'
                    : 'effectiveness for later points'}
                  .
                </p>
              ))}
            </div>
          </section>
        </div>
      )}
    </Modal>
  );
}
