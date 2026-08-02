import { useMemo } from 'react';
import { useSocialState } from '../../game/state/socialStore';

export function RegionTab({ pl }: { pl: boolean }): React.JSX.Element {
  const social = useSocialState();
  const goals = useMemo(
    () => social.regionGoals.length
      ? social.regionGoals
      : [{ regionKey: 'ashen-march', phaseKey: 'warding', target: 10_000, totalEffectiveContribution: 0 }],
    [social.regionGoals],
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {goals.map((goal) => {
        const percent = Math.min(100, goal.totalEffectiveContribution / goal.target * 100);
        return (
          <article key={`${goal.regionKey}:${goal.phaseKey}`} className="rounded-xl border border-amber-300/20 bg-slate-950/45 p-4">
            <p className="eyebrow">{goal.regionKey}</p>
            <h3 className="mt-1 font-display text-xl text-amber-100">{goal.phaseKey}</h3>
            <div className="mt-3 h-2 overflow-hidden rounded bg-black/50">
              <div className="h-full bg-amber-400" style={{ width: `${percent}%` }} />
            </div>
            <p className="mt-1 text-xs text-slate-500">{goal.totalEffectiveContribution}/{goal.target}</p>
            <p className="mt-3 text-xs leading-5 text-slate-400">
              {pl
                ? 'Wkład jest naliczany wyłącznie za kwalifikowane aktywności serwera. Osobiste limity i malejące zwroty ograniczają dominację jednej gildii.'
                : 'Contribution is awarded only by qualified server activities. Personal caps and diminishing returns limit guild domination.'}
            </p>
          </article>
        );
      })}
    </div>
  );
}
