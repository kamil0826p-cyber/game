import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/common/Button';
import { LocaleToggle } from '../components/common/LocaleToggle';
import { MobileUnsupportedNotice } from '../components/common/MobileUnsupportedNotice';
import { OutfitPreview } from '../components/common/OutfitPreview';
import { Panel } from '../components/common/Panel';
import { useGameConnection } from '../game/realtime/GameConnectionProvider';
import type { CharacterRosterEntry } from '../game/realtime/characterRosterClient';
import { useGameState } from '../game/state/gameStore';
import { useI18n } from '../i18n/I18nProvider';
import { CLASS_PRESENTATION, OUTFIT_CATALOG } from '../mock/outfitCatalog';
import { CharacterCreatorScreen } from './CharacterCreatorScreen';

const classLabelKey = { MAGE: 'class.mage', WARRIOR: 'class.warrior', ARCHER: 'class.archer' } as const;

function OutfitArrow({ direction }: { direction: 'left' | 'right' }): React.JSX.Element {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={direction === 'left' ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6'} />
    </svg>
  );
}

export function CharacterSelectScreen(): React.JSX.Element {
  const state = useGameState();
  const connection = useGameConnection();
  const { signOut } = useAuth();
  const { t } = useI18n();
  const [characters, setCharacters] = useState<CharacterRosterEntry[]>([]);
  const [maxCharacters, setMaxCharacters] = useState(5);
  const [selectedId, setSelectedId] = useState(state.self?.characterId ?? '');
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    const roster = await connection.listCharacters();
    setCharacters(roster.characters);
    setMaxCharacters(roster.maxCharacters);
    setSelectedId((current) => roster.characters.some((entry) => entry.characterId === current)
      ? current
      : state.self?.characterId ?? roster.characters[0]?.characterId ?? '');
  };

  useEffect(() => { void refresh().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Could not load characters.')); }, []);

  const selected = characters.find((entry) => entry.characterId === selectedId) ?? characters[0];
  const unlockedOutfits = useMemo(
    () => selected ? OUTFIT_CATALOG[selected.characterClass].filter((outfit) => outfit.unlockLevel <= selected.level) : [],
    [selected],
  );

  if (creating) {
    return <CharacterCreatorScreen onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); void refresh(); }} />;
  }

  const enterWorld = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (state.self?.characterId !== selected.characterId) await connection.selectCharacter(selected.characterId);
      await connection.enterWorld();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not enter the world.');
    } finally {
      setBusy(false);
    }
  };

  const changeOutfit = async (direction: number) => {
    if (!selected || unlockedOutfits.length === 0 || busy) return;
    const currentIndex = Math.max(0, unlockedOutfits.findIndex((outfit) => outfit.key === selected.outfitKey));
    const next = unlockedOutfits[(currentIndex + direction + unlockedOutfits.length) % unlockedOutfits.length]!;
    setBusy(true);
    setError(null);
    try {
      const updated = await connection.updateCharacterOutfit(selected.characterId, next.key);
      setCharacters((current) => current.map((entry) => entry.characterId === updated.characterId ? updated : entry));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not change outfit.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="auth-background h-dvh overflow-y-auto p-5 text-slate-100">
      <MobileUnsupportedNotice />
      <Panel elevated className="mx-auto w-full max-w-6xl overflow-hidden">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 p-6 sm:p-8">
          <div>
            <p className="eyebrow">{state.realm?.name ?? 'Game realm'}</p>
            <h1 className="font-display mt-2 text-3xl text-amber-100">{t('character.selectTitle')}</h1>
            <p className="mt-2 text-sm text-slate-400">Choose one of your characters and prepare its outfit before entering.</p>
          </div>
          <div className="flex items-center gap-2"><LocaleToggle /><Button variant="ghost" onClick={() => void signOut()} type="button">{t('hud.signOut')}</Button></div>
        </header>

        <section className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[0.72fr_1.28fr]">
          <aside>
            <div className="mb-3 flex items-center justify-between"><p className="eyebrow">Characters</p><span className="text-xs text-slate-400">{characters.length}/{maxCharacters}</span></div>
            <div className="grid gap-2">
              {characters.map((character) => (
                <button key={character.characterId} type="button" onClick={() => setSelectedId(character.characterId)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${selected?.characterId === character.characterId ? 'border-amber-400/60 bg-amber-500/10' : 'border-white/10 bg-slate-950/35 hover:border-amber-400/30'}`}>
                  <OutfitPreview outfitKey={character.outfitKey} characterClass={character.characterClass} size="small" animated={false} />
                  <span><strong className="block font-display text-lg text-amber-100">{character.name}</strong><span className="text-xs text-slate-400">Lv. {character.level} {t(classLabelKey[character.characterClass])}</span></span>
                </button>
              ))}
            </div>
            <Button className="mt-4 w-full justify-center" type="button" disabled={characters.length >= maxCharacters || busy} onClick={() => setCreating(true)}>Create character</Button>
            {characters.length >= maxCharacters ? <p className="mt-2 text-center text-xs text-slate-500">Character limit reached.</p> : null}
          </aside>

          {selected ? <div className="grid gap-6 md:grid-cols-[0.85fr_1.15fr]">
            <div>
              <div className="character-pedestal"><OutfitPreview outfitKey={selected.outfitKey} characterClass={selected.characterClass} /></div>
              <div className="mt-4 flex items-center justify-between gap-3">
                <button type="button" className="preview-arrow" disabled={busy} onClick={() => void changeOutfit(-1)} aria-label="Previous outfit"><OutfitArrow direction="left" /></button>
                <div className="text-center"><p className="eyebrow">Outfit</p><h3 className="font-display text-lg text-amber-100">{unlockedOutfits.find((outfit) => outfit.key === selected.outfitKey)?.label ?? selected.outfitKey}</h3><p className="mt-1 text-xs text-slate-400">{unlockedOutfits.length} of 10 unlocked</p></div>
                <button type="button" className="preview-arrow" disabled={busy} onClick={() => void changeOutfit(1)} aria-label="Next outfit"><OutfitArrow direction="right" /></button>
              </div>
            </div>
            <div className="flex flex-col justify-center">
              <h2 className="font-display text-4xl text-slate-50">{selected.name}</h2>
              <p className={`mt-2 text-sm font-semibold uppercase tracking-[0.18em] ${CLASS_PRESENTATION[selected.characterClass].accent}`}>{t('common.level')} {selected.level} {t(classLabelKey[selected.characterClass])}</p>
              <div className="mt-6 grid grid-cols-2 gap-3 text-sm"><Info label={t('common.position')} value={`${selected.x}, ${selected.y}`} /><Info label={t('common.outfit')} value={selected.outfitKey} /><Info label="Experience" value={String(selected.experience)} /><Info label={t('common.realm')} value={state.realm?.slug ?? 'world-1'} /></div>
              <div className="mt-6 grid gap-3 sm:grid-cols-2"><Meter label={t('hud.health')} value={selected.hp} max={selected.maxHp} tone="health" /><Meter label={t('hud.energy')} value={selected.energy} max={selected.maxEnergy} tone="energy" /></div>
              {error ? <p role="alert" className="mt-5 rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-sm text-rose-100">{error}</p> : null}
              <Button className="mt-8 justify-center py-3 text-base" onClick={() => void enterWorld()} type="button" busy={busy}>{t('character.enterWorld')}</Button>
            </div>
          </div> : <div className="flex items-center justify-center text-slate-400">Loading characters…</div>}
        </section>
      </Panel>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p><p className="mt-1 truncate text-sm font-semibold text-slate-200" title={value}>{value}</p></div>;
}

function Meter({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'health' | 'energy' }): React.JSX.Element {
  const percentage = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div><div className="mb-1 flex justify-between text-xs text-slate-400"><span>{label}</span><span>{value} / {max}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-950"><div className={`h-full ${tone === 'health' ? 'bg-rose-500' : 'bg-sky-500'}`} style={{ width: `${percentage}%` }} /></div></div>;
}
