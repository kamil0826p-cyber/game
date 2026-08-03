import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/common/Button';
import { LocaleToggle } from '../components/common/LocaleToggle';
import { OutfitPreview } from '../components/common/OutfitPreview';
import { Panel } from '../components/common/Panel';
import type { CharacterClass, CharacterGender } from '../contracts/game';
import { useGameConnection } from '../game/realtime/GameConnectionProvider';
import { useGameState } from '../game/state/gameStore';
import { useI18n } from '../i18n/I18nProvider';
import { CLASS_PRESENTATION, getOutfitForLevel } from '../mock/outfitCatalog';

const characterNamePattern = /^[A-Za-z][A-Za-z0-9 _-]{2,19}$/;
const GENDER_OPTIONS: ReadonlyArray<{ value: CharacterGender; label: string; description: string }> = [
  { value: 'MALE', label: 'Male', description: 'Uses the male outfit sprite set.' },
  { value: 'FEMALE', label: 'Female', description: 'Uses the female outfit sprite set.' },
];

export function CharacterCreatorScreen({ onCancel, onCreated }: { onCancel?: () => void; onCreated?: () => void }): React.JSX.Element {
  const state = useGameState();
  const client = useGameConnection();
  const { signOut } = useAuth();
  const { t } = useI18n();
  const available = state.allowedClasses.length > 0 ? state.allowedClasses : (['MAGE', 'WARRIOR', 'ARCHER'] satisfies CharacterClass[]);
  const [characterClass, setCharacterClass] = useState<CharacterClass>(available[0] ?? 'MAGE');
  const [gender, setGender] = useState<CharacterGender>('MALE');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const preview = getOutfitForLevel(characterClass, 1);
  const classInfo = CLASS_PRESENTATION[characterClass];
  const validName = characterNamePattern.test(name.trim());
  const startingStats = useMemo(() => characterClass === 'MAGE' ? ['75 Health', '120 Energy', '14 Intelligence'] : characterClass === 'WARRIOR' ? ['130 Health', '70 Energy', '14 Strength'] : ['95 Health', '95 Energy', '14 Agility'], [characterClass]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!validName) {
      setFormError('Use 3-20 characters. Start with a letter and use letters, numbers, spaces, hyphens, or underscores.');
      return;
    }
    setBusy(true);
    try {
      await client.createCharacterWithAppearance(name.trim(), characterClass, gender);
      onCreated?.();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Character creation failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-background h-dvh overflow-y-auto p-4 text-slate-100 sm:p-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div><p className="eyebrow">{state.realm?.name ?? 'Game realm'}</p><h1 className="font-display mt-1 text-3xl text-amber-100">{t('character.createTitle')}</h1></div>
        <div className="flex items-center gap-2">{onCancel ? <Button variant="ghost" onClick={onCancel} type="button">Back</Button> : null}<LocaleToggle /><Button variant="ghost" onClick={() => void signOut()} type="button">{t('hud.signOut')}</Button></div>
      </div>
      <form onSubmit={submit} className="mx-auto mt-6 grid max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Panel elevated className="p-5 sm:p-7">
          <p className="eyebrow">Choose a class</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {available.map((candidate) => { const presentation = CLASS_PRESENTATION[candidate]; const selected = candidate === characterClass; const startingOutfit = getOutfitForLevel(candidate, 1); return (
              <button key={candidate} type="button" onClick={() => setCharacterClass(candidate)} className={`class-card ${selected ? 'class-card-selected' : ''}`}>
                <OutfitPreview outfitKey={startingOutfit.key} characterClass={candidate} gender={gender} size="small" />
                <span className={`mt-2 font-display text-xl ${presentation.accent}`}>{presentation.label}</span><span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">{presentation.role}</span>
              </button>
            ); })}
          </div>
          <div className="mt-6 rounded-xl border border-white/10 bg-slate-950/40 p-5"><h2 className={`font-display text-2xl ${classInfo.accent}`}>{classInfo.label}</h2><p className="mt-2 text-sm leading-6 text-slate-300">{classInfo.description}</p><div className="mt-4 flex flex-wrap gap-2">{startingStats.map((stat) => <span key={stat} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">{stat}</span>)}</div></div>
          <fieldset className="mt-6">
            <legend className="field-label">Gender</legend>
            <div className="mt-2 grid grid-cols-2 gap-3">
              {GENDER_OPTIONS.map((option) => {
                const selected = option.value === gender;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setGender(option.value)}
                    className={`rounded-xl border p-4 text-left transition ${selected ? 'border-amber-400/60 bg-amber-500/10' : 'border-white/10 bg-slate-950/35 hover:border-amber-400/30'}`}
                  >
                    <strong className="font-display text-lg text-amber-100">{option.label}</strong>
                    <span className="mt-1 block text-xs leading-5 text-slate-400">{option.description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <label className="field-label mt-6"><span>{t('character.name')}</span><input className="text-input" value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} placeholder="Example: Rowan Storm" minLength={3} maxLength={20} autoFocus required /></label>
          {formError ? <div role="alert" className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-sm text-rose-100">{formError}</div> : null}
        </Panel>
        <Panel elevated className="relative overflow-hidden p-5 sm:p-7"><div className="absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_50%_30%,rgba(251,191,36,0.12),transparent_60%)]" /><div className="relative">
          <p className="eyebrow">Starting outfit</p><div className="mt-5 flex min-h-72 items-center justify-center rounded-xl border border-white/10 bg-slate-950/45"><OutfitPreview outfitKey={preview.key} characterClass={characterClass} gender={gender} /></div>
          <div className="mt-5 text-center"><h2 className="font-display text-xl text-amber-100">{preview.label}</h2><p className="mt-1 text-xs text-slate-400">{preview.description}</p></div>
          <p className="mt-5 rounded-lg border border-amber-400/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-100/80">Outfits change automatically every 10 levels. Each tier uses its own PNG; there is no recoloring or manual outfit selection.</p><Button className="mt-6 w-full justify-center py-3" type="submit" busy={busy} disabled={!validName}>{t('character.create')}</Button>
        </div></Panel>
      </form>
    </main>
  );
}
