import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/common/Button';
import { LocaleToggle } from '../components/common/LocaleToggle';
import { MobileUnsupportedNotice } from '../components/common/MobileUnsupportedNotice';
import { OutfitPreview } from '../components/common/OutfitPreview';
import { Panel } from '../components/common/Panel';
import { useGameConnection } from '../game/realtime/GameConnectionProvider';
import {
  changeCharacterOutfit,
  listCharacters,
  selectCharacter,
  type CharacterLobbySummary,
} from '../game/realtime/characterLobby';
import { gameStore, useGameState } from '../game/state/gameStore';
import { useI18n } from '../i18n/I18nProvider';
import { CLASS_PRESENTATION, OUTFIT_CATALOG } from '../mock/outfitCatalog';

const MAX_CHARACTERS = 5;
const classLabelKey = { MAGE: 'class.mage', WARRIOR: 'class.warrior', ARCHER: 'class.archer' } as const;
const zoneLabelKey = { SAFE: 'map.zone.safe', OUTLAW: 'map.zone.outlaw', PVP: 'map.zone.pvp' } as const;

export function CharacterSelectScreen(): React.JSX.Element {
  const state = useGameState();
  const connection = useGameConnection();
  const { signOut } = useAuth();
  const { t, locale } = useI18n();
  const [characters, setCharacters] = useState<CharacterLobbySummary[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const character = state.self;
  const map = state.map;

  useEffect(() => {
    let active = true;
    void listCharacters(connection)
      .then((items) => { if (active) setCharacters(items); })
      .catch((error: unknown) => { if (active) setLoadError(error instanceof Error ? error.message : 'Nie udało się pobrać postaci.'); });
    return () => { active = false; };
  }, [connection, character?.characterId, character?.outfitKey]);

  const outfits = useMemo(() => character ? OUTFIT_CATALOG[character.characterClass] : [], [character]);
  const unlocked = useMemo(() => new Set(state.unlockedOutfits.map((outfit) => outfit.key)), [state.unlockedOutfits]);

  if (!character || !map) return <div />;
  const classInfo = CLASS_PRESENTATION[character.characterClass];

  const run = async (key: string, action: () => Promise<unknown>) => {
    if (busyAction) return;
    setBusyAction(key);
    setLoadError(null);
    try { await action(); }
    catch (error) { setLoadError(error instanceof Error ? error.message : 'Operacja nie powiodła się.'); }
    finally { setBusyAction(null); }
  };

  const enterWorld = () => run('enter', () => connection.enterWorld());
  const chooseCharacter = (id: string) => run(`character:${id}`, () => selectCharacter(connection, id));
  const chooseOutfit = (outfitKey: string) => run(`outfit:${outfitKey}`, () => changeCharacterOutfit(connection, character.characterId, outfitKey));
  const createAnother = () => gameStore.requireCharacter(['MAGE', 'WARRIOR', 'ARCHER']);

  return (
    <main className="auth-background h-dvh overflow-y-auto p-4 text-slate-100 sm:p-6">
      <MobileUnsupportedNotice />
      <Panel elevated className="mx-auto w-full max-w-6xl overflow-hidden">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 p-5 sm:p-7">
          <div>
            <p className="eyebrow">{state.realm?.name ?? 'Game realm'}</p>
            <h1 className="font-display mt-2 text-3xl text-amber-100">{t('character.selectTitle')}</h1>
            <p className="mt-2 text-sm text-slate-400">{locale === 'pl' ? `Postacie: ${characters.length}/${MAX_CHARACTERS}` : `Characters: ${characters.length}/${MAX_CHARACTERS}`}</p>
          </div>
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <Button variant="ghost" onClick={() => void signOut()} type="button">{t('hud.signOut')}</Button>
          </div>
        </header>

        <section className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[0.72fr_1.28fr]">
          <div>
            <div className="grid gap-3">
              {characters.map((candidate) => {
                const selected = candidate.id === character.characterId;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    disabled={Boolean(busyAction)}
                    onClick={() => void chooseCharacter(candidate.id)}
                    className={`flex items-center gap-4 rounded-xl border p-3 text-left transition ${selected ? 'border-amber-400/60 bg-amber-500/10' : 'border-white/10 bg-slate-950/40 hover:border-amber-300/30'}`}
                  >
                    <OutfitPreview outfitKey={candidate.outfitKey} characterClass={candidate.characterClass} size="small" animated={selected} />
                    <span className="min-w-0 flex-1">
                      <span className="font-display block truncate text-xl text-slate-100">{candidate.name}</span>
                      <span className="mt-1 block text-xs uppercase tracking-wider text-slate-400">{t('common.level')} {candidate.level} · {t(classLabelKey[candidate.characterClass])}</span>
                    </span>
                    {busyAction === `character:${candidate.id}` ? <span className="text-xs text-amber-200">…</span> : null}
                  </button>
                );
              })}
            </div>
            <Button className="mt-4 w-full justify-center" variant="ghost" type="button" disabled={characters.length >= MAX_CHARACTERS || Boolean(busyAction)} onClick={createAnother}>
              {characters.length >= MAX_CHARACTERS ? (locale === 'pl' ? 'Osiągnięto limit 5 postaci' : 'Five-character limit reached') : (locale === 'pl' ? 'Utwórz kolejną postać' : 'Create another character')}
            </Button>
          </div>

          <div className="rounded-2xl border border-white/10 bg-slate-950/30 p-5 sm:p-6">
            <div className="grid gap-6 sm:grid-cols-[180px_1fr]">
              <div className="character-pedestal min-h-56"><OutfitPreview outfitKey={character.outfitKey} characterClass={character.characterClass} /></div>
              <div className="flex flex-col justify-center">
                <div className="flex flex-wrap items-center gap-3">
                  <h2 className="font-display text-4xl text-slate-50">{character.name}</h2>
                  <span className={`zone-badge zone-${map.zoneType.toLowerCase()}`}>{t(zoneLabelKey[map.zoneType])}</span>
                </div>
                <p className={`mt-2 text-sm font-semibold uppercase tracking-[0.18em] ${classInfo.accent}`}>{t('common.level')} {character.level} {t(classLabelKey[character.characterClass])}</p>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                  <Info label={t('common.map')} value={map.name} />
                  <Info label={t('common.position')} value={`${character.x}, ${character.y}`} />
                  <Info label={t('common.outfit')} value={character.outfitKey} />
                  <Info label={t('common.realm')} value={state.realm?.slug ?? 'world-1'} />
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Meter label={t('hud.health')} value={character.hp} max={character.maxHp} tone="health" />
                  <Meter label={t('hud.energy')} value={character.energy} max={character.maxEnergy} tone="energy" />
                </div>
              </div>
            </div>

            <div className="mt-6 border-t border-white/10 pt-5">
              <div className="flex items-center justify-between gap-4">
                <div><p className="eyebrow">{locale === 'pl' ? 'Zmień outfit' : 'Change outfit'}</p><p className="mt-1 text-xs text-slate-400">{locale === 'pl' ? 'Zmiana jest zapisywana przed wejściem do świata.' : 'The change is saved before entering the world.'}</p></div>
                <span className="text-xs text-slate-500">{outfits.length} outfitów</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
                {outfits.map((outfit) => {
                  const available = unlocked.has(outfit.key);
                  const selected = outfit.key === character.outfitKey;
                  return (
                    <button
                      key={outfit.key}
                      type="button"
                      disabled={!available || Boolean(busyAction)}
                      onClick={() => void chooseOutfit(outfit.key)}
                      className={`relative rounded-xl border p-2 text-center transition ${selected ? 'border-amber-400/70 bg-amber-500/10' : available ? 'border-white/10 bg-slate-950/40 hover:border-amber-300/40' : 'cursor-not-allowed border-white/5 bg-slate-950/20 opacity-45'}`}
                    >
                      <OutfitPreview outfitKey={outfit.key} characterClass={character.characterClass} size="small" animated={false} className="mx-auto" />
                      <span className="mt-1 block truncate text-[10px] font-semibold text-slate-200" title={outfit.label}>{outfit.label}</span>
                      {!available ? <span className="mt-1 block text-[9px] text-amber-300">Lv. {outfit.unlockLevel}</span> : null}
                    </button>
                  );
                })}
              </div>
            </div>

            {loadError ? <div role="alert" className="mt-4 rounded-lg border border-rose-500/40 bg-rose-950/50 p-3 text-sm text-rose-100">{loadError}</div> : null}
            <Button className="mt-6 w-full justify-center py-3 text-base" onClick={() => void enterWorld()} type="button" busy={busyAction === 'enter'} disabled={Boolean(busyAction) && busyAction !== 'enter'}>{t('character.enterWorld')}</Button>
          </div>
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
