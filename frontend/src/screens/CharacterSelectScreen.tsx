import { useEffect, useState } from 'react';
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
import { CLASS_PRESENTATION, getOutfitForLevel } from '../mock/outfitCatalog';
import { CharacterCreatorScreen } from './CharacterCreatorScreen';

const classLabelKey = { MAGE: 'class.mage', WARRIOR: 'class.warrior', ARCHER: 'class.archer' } as const;
const genderLabel = (gender: CharacterRosterEntry['gender']): string => gender === 'FEMALE' ? 'Female' : 'Male';

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
  const selectedOutfit = selected ? getOutfitForLevel(selected.characterClass, selected.level) : undefined;
  const nextOutfit = selected
    ? getNextOutfitLevel(selected.characterClass, selected.level)
    : undefined;

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

  return (
    <main className="auth-background h-dvh overflow-y-auto p-5 text-slate-100">
      <MobileUnsupportedNotice />
      <Panel elevated className="mx-auto w-full max-w-6xl overflow-hidden">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 p-6 sm:p-8">
          <div>
            <p className="eyebrow">{state.realm?.name ?? 'Game realm'}</p>
            <h1 className="font-display mt-2 text-3xl text-amber-100">{t('character.selectTitle')}</h1>
            <p className="mt-2 text-sm text-slate-400">Choose one of your characters. Its outfit is assigned automatically from its class and level.</p>
          </div>
          <div className="flex items-center gap-2"><LocaleToggle /><Button variant="ghost" onClick={() => void signOut()} type="button">{t('hud.signOut')}</Button></div>
        </header>

        <section className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[0.72fr_1.28fr]">
          <aside>
            <div className="mb-3 flex items-center justify-between"><p className="eyebrow">Characters</p><span className="text-xs text-slate-400">{characters.length}/{maxCharacters}</span></div>
            <div className="grid gap-2">
              {characters.map((character) => {
                const outfit = getOutfitForLevel(character.characterClass, character.level);
                return (
                  <button key={character.characterId} type="button" onClick={() => setSelectedId(character.characterId)} className={`flex items-center gap-3 rounded-xl border p-3 text-left transition ${selected?.characterId === character.characterId ? 'border-amber-400/60 bg-amber-500/10' : 'border-white/10 bg-slate-950/35 hover:border-amber-400/30'}`}>
                    <OutfitPreview outfitKey={outfit.key} characterClass={character.characterClass} gender={character.gender ?? 'MALE'} size="small" animated={false} />
                    <span><strong className="block font-display text-lg text-amber-100">{character.name}</strong><span className="text-xs text-slate-400">Lv. {character.level} {t(classLabelKey[character.characterClass])} · {genderLabel(character.gender)}</span></span>
                  </button>
                );
              })}
            </div>
            <Button className="mt-4 w-full justify-center" type="button" disabled={characters.length >= maxCharacters || busy} onClick={() => setCreating(true)}>Create character</Button>
            {characters.length >= maxCharacters ? <p className="mt-2 text-center text-xs text-slate-500">Character limit reached.</p> : null}
          </aside>

          {selected && selectedOutfit ? <div className="grid gap-6 md:grid-cols-[0.85fr_1.15fr]">
            <div>
              <div className="character-pedestal"><OutfitPreview outfitKey={selectedOutfit.key} characterClass={selected.characterClass} gender={selected.gender ?? 'MALE'} /></div>
              <div className="mt-4 text-center">
                <p className="eyebrow">Current outfit</p>
                <h3 className="font-display text-lg text-amber-100">{selectedOutfit.label}</h3>
                <p className="mt-1 text-xs text-slate-400">Assigned automatically at level {selectedOutfit.unlockLevel}.{nextOutfit ? ` Next outfit at level ${nextOutfit}.` : ' Final outfit tier reached.'}</p>
              </div>
            </div>
            <div className="flex flex-col justify-center">
              <h2 className="font-display text-4xl text-slate-50">{selected.name}</h2>
              <p className={`mt-2 text-sm font-semibold uppercase tracking-[0.18em] ${CLASS_PRESENTATION[selected.characterClass].accent}`}>{t('common.level')} {selected.level} {t(classLabelKey[selected.characterClass])}</p>
              <div className="mt-6 grid grid-cols-2 gap-3 text-sm"><Info label="Gender" value={genderLabel(selected.gender)} /><Info label={t('common.position')} value={`${selected.x}, ${selected.y}`} /><Info label={t('common.outfit')} value={selectedOutfit.key} /><Info label="Experience" value={String(selected.experience)} /><Info label={t('common.realm')} value={state.realm?.slug ?? 'world-1'} /></div>
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

function getNextOutfitLevel(characterClass: CharacterRosterEntry['characterClass'], level: number): number | undefined {
  const currentTier = Math.max(0, Math.floor(Math.max(1, level) / 10));
  const nextLevel = currentTier === 0 ? 10 : (currentTier + 1) * 10;
  return nextLevel <= 100 ? nextLevel : undefined;
}

function Info({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3"><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p><p className="mt-1 truncate text-sm font-semibold text-slate-200" title={value}>{value}</p></div>;
}

function Meter({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'health' | 'energy' }): React.JSX.Element {
  const percentage = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div><div className="mb-1 flex justify-between text-xs text-slate-400"><span>{label}</span><span>{value} / {max}</span></div><div className="h-2 overflow-hidden rounded-full bg-slate-950"><div className={`h-full ${tone === 'health' ? 'bg-rose-500' : 'bg-sky-500'}`} style={{ width: `${percentage}%` }} /></div></div>;
}
