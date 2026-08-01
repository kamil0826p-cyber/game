import type { CombatSnapshot } from '../../contracts/socket';
import { useI18n } from '../../i18n/I18nProvider';

export function EncounterSummary({
  combat,
}: {
  combat: CombatSnapshot;
}): React.JSX.Element | null {
  const { locale } = useI18n();
  const encounter = combat.encounter;
  if (!encounter) return null;
  return (
    <aside
      className="fixed left-4 top-4 z-[90] w-[min(22rem,calc(100vw-2rem))] rounded-lg border border-amber-200/35 bg-black/80 px-4 py-3 text-amber-50 shadow-2xl backdrop-blur"
      aria-label={locale === 'pl' ? 'Informacje o encounterze' : 'Encounter information'}
      data-encounter-key={encounter.key}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <small className="block text-[9px] uppercase tracking-[0.24em] text-amber-300/70">
            {locale === 'pl' ? 'Encounter PvE' : 'PvE encounter'} · v{encounter.version}
          </small>
          <strong className="block text-sm text-amber-100">{encounter.name}</strong>
        </div>
        <span className="rounded border border-amber-200/25 px-2 py-1 text-[9px] uppercase text-amber-200">
          {encounter.difficulty}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-slate-200">
        <b className="text-amber-200">
          {locale === 'pl' ? 'Faza' : 'Phase'} {encounter.phaseIndex + 1}/{encounter.phaseCount}: {encounter.phaseLabel}
        </b>
        {encounter.arenaModifier ? <span>◈ {encounter.arenaModifier}</span> : null}
        <span>
          {locale === 'pl' ? 'Drużyna' : 'Party'} {encounter.partySize} ·{' '}
          {locale === 'pl' ? 'zalecane' : 'recommended'} {encounter.recommendedPartySize}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1" aria-label={locale === 'pl' ? 'Aktywne mechaniki' : 'Active mechanics'}>
        {encounter.mechanics.slice(0, 5).map((mechanic) => (
          <span
            key={mechanic}
            className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[8px] text-slate-300"
          >
            {mechanic.replaceAll('_', ' ')}
          </span>
        ))}
      </div>
    </aside>
  );
}
