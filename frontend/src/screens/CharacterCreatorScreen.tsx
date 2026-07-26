import { useMemo, useState, type ChangeEvent, type FormEvent } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/common/Button';
import { LocaleToggle } from '../components/common/LocaleToggle';
import { OutfitPreview } from '../components/common/OutfitPreview';
import type { CharacterClass } from '../contracts/game';
import { useGameConnection } from '../game/realtime/GameConnectionProvider';
import { useGameState } from '../game/state/gameStore';
import { useI18n } from '../i18n/I18nProvider';
import { CLASS_PRESENTATION, OUTFIT_CATALOG } from '../mock/outfitCatalog';

const characterNamePattern = /^[A-Za-z][A-Za-z0-9 _-]{2,19}$/;

export function CharacterCreatorScreen(): React.JSX.Element {
  const state = useGameState();
  const client = useGameConnection();
  const { signOut } = useAuth();
  const { t } = useI18n();
  const available = state.allowedClasses.length > 0 ? state.allowedClasses : (['MAGE', 'WARRIOR', 'ARCHER'] satisfies CharacterClass[]);
  const [characterClass, setCharacterClass] = useState<CharacterClass>(available[0] ?? 'MAGE');
  const [previewIndex, setPreviewIndex] = useState(0);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const outfits = OUTFIT_CATALOG[characterClass];
  const preview = outfits[previewIndex] ?? outfits[0]!;
  const classInfo = CLASS_PRESENTATION[characterClass];
  const validName = characterNamePattern.test(name.trim());

  const startingStats = useMemo(() => characterClass === 'MAGE'
    ? ['75 Health', '120 Energy', '14 Intelligence']
    : characterClass === 'WARRIOR'
      ? ['130 Health', '70 Energy', '14 Strength']
      : ['95 Health', '95 Energy', '14 Agility'], [characterClass]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    if (!validName) {
      setFormError('Use 3-20 characters. Start with a letter and use letters, numbers, spaces, hyphens, or underscores.');
      return;
    }
    setBusy(true);
    try { await client.createCharacter(name.trim(), characterClass); }
    catch (error) { setFormError(error instanceof Error ? error.message : 'Character creation failed.'); }
    finally { setBusy(false); }
  };

  const selectClass = (nextClass: CharacterClass) => {
    setCharacterClass(nextClass);
    setPreviewIndex(0);
  };

  return (
    <main className="royal-creation min-h-dvh overflow-y-auto text-stone-100">
      <header className="royal-creation-header">
        <div><p className="royal-kicker">{state.realm?.name ?? 'Game realm'}</p><h1>{t('character.createTitle')}</h1></div>
        <div className="flex items-center gap-2"><LocaleToggle /><Button variant="ghost" onClick={() => void signOut()} type="button">{t('hud.signOut')}</Button></div>
      </header>

      <form onSubmit={submit} className="royal-creation-grid">
        <aside className="royal-class-rail">
          <p className="royal-overline">Choose your calling</p>
          {available.map((candidate, index) => {
            const presentation = CLASS_PRESENTATION[candidate];
            const selected = candidate === characterClass;
            return (
              <button key={candidate} type="button" onClick={() => selectClass(candidate)} className={`royal-class-choice ${selected ? 'is-selected' : ''}`}>
                <span className="royal-class-index">0{index + 1}</span>
                <OutfitPreview outfitKey={OUTFIT_CATALOG[candidate][0]!.key} characterClass={candidate} size="small" />
                <span><strong>{presentation.label}</strong><small>{presentation.role}</small></span>
              </button>
            );
          })}
        </aside>

        <section className="royal-character-stage">
          <div className="royal-stage-rune" />
          <div className="royal-stage-title"><span>{classInfo.role}</span><h2>{classInfo.label}</h2></div>
          <div className="royal-outfit-showcase"><OutfitPreview outfitKey={preview.key} characterClass={characterClass} /></div>
          <div className="royal-outfit-nav">
            <button type="button" onClick={() => setPreviewIndex((previewIndex - 1 + outfits.length) % outfits.length)} aria-label="Previous outfit">‹</button>
            <div><strong>{preview.label}</strong><small>{preview.description}</small></div>
            <button type="button" onClick={() => setPreviewIndex((previewIndex + 1) % outfits.length)} aria-label="Next outfit">›</button>
          </div>
        </section>

        <aside className="royal-character-ledger">
          <p className="royal-overline">Write the first page</p>
          <h3>{classInfo.description}</h3>
          <div className="royal-stat-list">{startingStats.map((stat) => <span key={stat}>{stat}</span>)}</div>
          <label className="field-label"><span>{t('character.name')}</span><input className="text-input" value={name} onChange={(event: ChangeEvent<HTMLInputElement>) => setName(event.target.value)} placeholder="Example: Rowan Storm" minLength={3} maxLength={20} autoFocus required /></label>
          <div className={`royal-unlock-note ${preview.unlockLevel === 1 ? 'is-open' : ''}`}><b>{preview.unlockLevel === 1 ? t('character.unlocked') : t('character.lockedAt', { level: preview.unlockLevel })}</b><span>The realm remains authoritative for outfit unlocks.</span></div>
          {formError ? <div role="alert" className="royal-error">{formError}</div> : null}
          <Button className="royal-primary-action" type="submit" busy={busy} disabled={!validName}>{t('character.create')}</Button>
        </aside>
      </form>
    </main>
  );
}