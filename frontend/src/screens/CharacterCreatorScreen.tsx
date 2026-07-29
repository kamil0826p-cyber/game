import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/common/Button';
import { LocaleToggle } from '../components/common/LocaleToggle';
import { OutfitPreview } from '../components/common/OutfitPreview';
import { Panel } from '../components/common/Panel';
import type { CharacterClass } from '../contracts/game';
import { useGameConnection } from '../game/realtime/GameConnectionProvider';
import { useGameState } from '../game/state/gameStore';
import { useI18n } from '../i18n/I18nProvider';
import { CLASS_PRESENTATION, OUTFIT_CATALOG } from '../mock/outfitCatalog';

const characterNamePattern = /^[A-Za-z][A-Za-z0-9 _-]{2,19}$/;

export function CharacterCreatorScreen({ onCancel }: { onCancel?: () => void }): React.JSX.Element {
  const state = useGameState();
  const client = useGameConnection();
  const { signOut } = useAuth();
  const { t } = useI18n();
  const available = state.allowedClasses.length > 0
    ? state.allowedClasses
    : (['MAGE', 'WARRIOR', 'ARCHER'] satisfies CharacterClass[]);
  const [characterClass, setCharacterClass] = useState<CharacterClass>(available[0] ?? 'MAGE');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const outfits = OUTFIT_CATALOG[characterClass].filter((outfit) => outfit.unlockLevel === 1);
  const preview = outfits[previewIndex] ?? outfits[0]!;
  const classInfo = CLASS_PRESENTATION[characterClass];
  const validName = characterNamePattern.test(name.trim());

  const startingStats = useMemo(
    () => characterClass === 'MAGE'
      ? ['75 Health', '120 Energy', '14 Intelligence']
      : characterClass === 'WARRIOR'
        ? ['130 Health', '70 Energy', '14 Strength']
        : ['95 Health', '95 Energy', '14 Agility'],
    [characterClass],
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!validName) {
      setFormError('Use 3-20 characters. Start with a letter and use letters, numbers, spaces, hyphens, or underscores.');
      return;
    }
    setBusy(true);
    try {
      await client.createCharacterWithOutfit(name.trim(), characterClass, preview.key);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Character creation failed.');
    } finally {
      setBusy(false);
    }
  };

  const selectClass = (nextClass: CharacterClass) => {
    setCharacterClass(nextClass);
    setPreviewIndex(0);
  };

  return (
    <main className="auth-background h-dvh overflow-y-auto p-4 text-slate-100 sm:p-8">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div>
          <p className="eyebrow">{state.realm?.name ?? 'Game realm'}</p>
          <h1 className="font-display mt-1 text-3xl text-amber-100">{t('character.createTitle')}</h1>
        </div>
        <div className="flex items-center gap-2">
          {onCancel ? <Button variant="ghost" onClick={onCancel} type="button">Back</Button> : null}
          <LocaleToggle />
          <Button variant="ghost" onClick={() => void signOut()} type="button">{t('hud.signOut')}</Button>
        </div>
      </div>

      <form onSubmit={submit} className="mx-auto mt-6 grid max-w-6xl gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <Panel elevated className="p-5 sm:p-7">
          <p className="eyebrow">Choose a class</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {available.map((candidate) => {
              const presentation = CLASS_PRESENTATION[candidate];
              const selected = candidate === characterClass;
              return (
                <button key={candidate} type="button" onClick={() => selectClass(candidate)} className={`class-card ${selected ? 'class-card-selected' : ''}`}>
                  <OutfitPreview outfitKey={OUTFIT_CATALOG[candidate][0]!.key} characterClass={candidate} size="small" />
                  <span className={`mt-2 font-display text-xl ${presentation.accent}`}>{presentation.label}</span>
                  <span className="mt-1 text-[10px] uppercase tracking-[0.16em] text-slate-500">{presentation.role}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 rounded-xl border border-white/10 bg-slate-950/40 p-5">
            <h2 className={`font-display text-2xl ${classInfo.accent}`}>{classInfo.label}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">{classInfo.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {startingStats.map((stat) => <span key={stat} className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">{stat}</span>)}
            </div>
          </div>

          <label className="field-label mt-6">
            <span>{t('character.name')}</span>
            <input className="text-input" value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} placeholder="Example: Rowan Storm" minLength={3} maxLength={20} autoFocus required />
          </label>

          {formError ? <div role="alert" className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-sm text-rose-100">{formError}</div> : null}
        </Panel>

        <Panel elevated className="relative overflow-hidden p-5 sm:p-7">
          <div className="absolute inset-x-0 top-0 h-48 bg-[radial-gradient(circle_at_50%_30%,rgba(251,191,36,0.12),transparent_60%)]" />
          <div className="relative">
            <p className="eyebrow">{t('character.outfit')}</p>
            <div className="mt-5 flex min-h-72 items-center justify-center rounded-xl border border-white/10 bg-slate-950/45">
              <OutfitPreview outfitKey={preview.key} characterClass={characterClass} />
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" className="preview-arrow" onClick={() => setPreviewIndex((previewIndex - 1 + outfits.length) % outfits.length)} aria-label="Previous outfit">‹</button>
              <div className="text-center">
                <h2 className="font-display text-xl text-amber-100">{preview.label}</h2>
                <p className="mt-1 text-xs text-slate-400">{preview.description}</p>
                <span className="mt-3 inline-flex rounded-full border border-emerald-400/30 bg-emerald-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-200">{t('character.unlocked')}</span>
              </div>
              <button type="button" className="preview-arrow" onClick={() => setPreviewIndex((previewIndex + 1) % outfits.length)} aria-label="Next outfit">›</button>
            </div>
            <p className="mt-5 rounded-lg border border-amber-400/20 bg-amber-500/5 p-3 text-xs leading-5 text-amber-100/80">The selected level 1 outfit is saved immediately. More outfits unlock as the character levels up.</p>
            <Button className="mt-6 w-full justify-center py-3" type="submit" busy={busy} disabled={!validName}>{t('character.create')}</Button>
          </div>
        </Panel>
      </form>
    </main>
  );
}
