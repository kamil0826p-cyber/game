import { useState, type FormEvent } from 'react';
import type { BuildFunction, FinderCreateInput, FinderListing } from '../../contracts/social';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useSocialState } from '../../game/state/socialStore';

const FUNCTIONS: BuildFunction[] = [
  'PROTECTION', 'INTERRUPT', 'CLEANSE', 'CONTROL',
  'BURST', 'SCOUT', 'SUSTAIN', 'SUPPORT',
];

export function FinderTab({ selfId, busy, pl, run }: { selfId?: string; busy: boolean; pl: boolean; run: (op: () => Promise<unknown>) => Promise<void> }): React.JSX.Element {
  const connection = useGameConnection();
  const social = useSocialState();
  const [title, setTitle] = useState(pl ? 'Popielna Pielgrzymka' : 'Ashen Pilgrimage');
  const [minimumSize, setMinimumSize] = useState(1);
  const [maximumSize, setMaximumSize] = useState(5);
  const [selectedFunctions, setSelectedFunctions] = useState<BuildFunction[]>(['SUPPORT']);
  const own = social.ownListing;
  const create = (event: FormEvent) => {
    event.preventDefault();
    const input: FinderCreateInput = {
      activityType: 'EXPEDITION',
      activityKey: 'expedition:ashen-pilgrimage',
      title,
      minimumSize,
      maximumSize,
      levelHint: { minimum: 5 },
      requestedFunctions: selectedFunctions,
      language: pl ? 'pl' : 'en',
      expectedMinutes: 45,
      riskProfile: 'STANDARD',
      requirements: { minimumLevel: 5 },
      acceptancePolicy: 'MANUAL',
      decisionPolicy: 'LEADER',
    };
    void run(() => connection.createFinderListing(input));
  };
  return (
    <div className="grid gap-5 lg:grid-cols-[.8fr_1.2fr]">
      <section className="space-y-4">
        {!own ? (
          <form onSubmit={create} className="space-y-3 rounded-xl border border-amber-300/20 bg-slate-950/45 p-4">
            <p className="eyebrow">{pl ? 'Nowe ogłoszenie' : 'New listing'}</p>
            <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} required className="w-full rounded border border-amber-300/20 bg-black/30 px-3 py-2 text-sm text-amber-50" />
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-slate-400">Min<input type="number" min={1} max={10} value={minimumSize} onChange={(event) => setMinimumSize(Number(event.target.value))} className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5" /></label>
              <label className="text-xs text-slate-400">Max<input type="number" min={1} max={10} value={maximumSize} onChange={(event) => setMaximumSize(Number(event.target.value))} className="mt-1 w-full rounded border border-white/10 bg-black/30 px-2 py-1.5" /></label>
            </div>
            <FunctionPicker selected={selectedFunctions} onChange={setSelectedFunctions} />
            <button disabled={busy || minimumSize > maximumSize} className="w-full rounded border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100 disabled:opacity-40">{pl ? 'Opublikuj' : 'Publish'}</button>
          </form>
        ) : <OwnListing listing={own} selfId={selfId} busy={busy} pl={pl} run={run} />}
      </section>
      <section className="rounded-xl border border-white/10 bg-slate-950/45 p-4">
        <div className="mb-3 flex items-center justify-between"><p className="eyebrow">{pl ? 'Aktywne ogłoszenia' : 'Active listings'}</p><span className="text-xs text-slate-500">{social.listings.length}</span></div>
        <div className="scrollbar-thin max-h-[500px] space-y-3 overflow-y-auto pr-1">
          {social.listings.length === 0 ? <p className="py-8 text-center text-sm text-slate-500">{pl ? 'Brak ogłoszeń.' : 'No listings.'}</p> : social.listings.map((listing) => (
            <article key={listing.id} className="rounded-lg border border-white/10 bg-white/[0.035] p-3">
              <div className="flex items-start justify-between gap-3"><div><strong className="text-amber-100">{listing.title}</strong><p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">{listing.activityType} · {listing.language} · {listing.expectedMinutes} min · {listing.riskProfile}</p></div><span className="rounded border border-white/10 px-2 py-1 text-[10px] text-slate-300">{listing.members.length}/{listing.maximumSize}</span></div>
              <div className="mt-2 flex flex-wrap gap-1">{listing.requestedFunctions.map((fn) => <span key={fn} className="rounded bg-amber-300/10 px-1.5 py-0.5 text-[9px] text-amber-200">{fn}</span>)}</div>
              {!listing.members.some((member) => member.characterId === selfId) ? <button disabled={busy} onClick={() => void run(() => connection.applyToFinder(listing.id, selectedFunctions))} className="mt-3 rounded border border-emerald-300/25 px-3 py-1.5 text-xs text-emerald-200 disabled:opacity-40">{pl ? 'Zgłoś się' : 'Apply'}</button> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function OwnListing({ listing, selfId, busy, pl, run }: { listing: FinderListing; selfId?: string; busy: boolean; pl: boolean; run: (op: () => Promise<unknown>) => Promise<void> }): React.JSX.Element {
  const connection = useGameConnection();
  const self = listing.members.find((member) => member.characterId === selfId);
  const missing = listing.members.filter((member) => !member.loadoutReady || !member.requirementsMet || !member.riskAccepted || member.reconnectStatus !== 'ONLINE');
  return <div className="space-y-3 rounded-xl border border-amber-300/20 bg-slate-950/45 p-4">
    <div><p className="eyebrow">{pl ? 'Twoje lobby' : 'Your lobby'}</p><h3 className="mt-1 font-display text-xl text-amber-100">{listing.title}</h3><p className="text-xs text-slate-500">{listing.status} · {listing.members.length}/{listing.maximumSize}</p></div>
    <div className="space-y-1">{listing.members.map((member) => <div key={member.characterId} className="flex items-center justify-between rounded border border-white/5 bg-white/[0.03] px-2 py-1.5 text-xs"><span>{member.name} · Lv. {member.level} · {member.formation}</span><span className={member.loadoutReady && member.requirementsMet && member.riskAccepted ? 'text-emerald-300' : 'text-amber-300'}>{member.loadoutReady && member.requirementsMet && member.riskAccepted ? 'READY' : 'WAIT'}</span></div>)}</div>
    {self && listing.status !== 'STARTED' ? <button disabled={busy} onClick={() => void run(() => connection.setFinderReady(listing.id, { functions: self.functions.length ? self.functions : ['SUPPORT'], formation: self.formation, loadoutReady: true, riskAccepted: true, consumableSummary: [] }))} className="rounded border border-emerald-300/25 px-3 py-1.5 text-xs text-emerald-200 disabled:opacity-40">{pl ? 'Potwierdź gotowość' : 'Confirm ready'}</button> : null}
    {listing.ownerCharacterId === selfId ? <div className="space-y-2 border-t border-white/5 pt-3">
      {listing.applicants.map((applicant) => <div key={applicant.characterId} className="flex items-center justify-between gap-2 text-xs"><span>{applicant.name} · {applicant.functions.join(', ')}</span><span className="flex gap-1"><button disabled={busy} onClick={() => void run(() => connection.respondFinderApplication(listing.id, applicant.characterId, true))} className="rounded border border-emerald-300/25 px-2 py-1 text-emerald-200">+</button><button disabled={busy} onClick={() => void run(() => connection.respondFinderApplication(listing.id, applicant.characterId, false))} className="rounded border border-rose-300/25 px-2 py-1 text-rose-200">−</button></span></div>)}
      <div className="flex gap-2"><button disabled={busy || missing.length > 0 || listing.members.length < listing.minimumSize} onClick={() => void run(() => connection.startFinderListing(listing.id))} className="flex-1 rounded border border-amber-300/35 bg-amber-300/10 px-3 py-2 text-xs text-amber-100 disabled:opacity-35">{pl ? 'Zamroź skład i rozpocznij' : 'Freeze roster & start'}</button><button disabled={busy} onClick={() => void run(() => connection.cancelFinderListing(listing.id))} className="rounded border border-rose-300/25 px-3 py-2 text-xs text-rose-200">{pl ? 'Anuluj' : 'Cancel'}</button></div>
    </div> : null}
  </div>;
}

function FunctionPicker({ selected, onChange }: { selected: BuildFunction[]; onChange: (next: BuildFunction[]) => void }): React.JSX.Element {
  return <div className="flex flex-wrap gap-1">{FUNCTIONS.map((fn) => <button key={fn} type="button" onClick={() => onChange(selected.includes(fn) ? selected.filter((value) => value !== fn) : [...selected, fn])} className={`rounded border px-1.5 py-1 text-[9px] ${selected.includes(fn) ? 'border-amber-300/35 bg-amber-300/10 text-amber-200' : 'border-white/10 text-slate-500'}`}>{fn}</button>)}</div>;
}

