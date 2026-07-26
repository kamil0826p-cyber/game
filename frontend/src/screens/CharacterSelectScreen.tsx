import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/common/Button';
import { LocaleToggle } from '../components/common/LocaleToggle';
import { OutfitPreview } from '../components/common/OutfitPreview';
import { Panel } from '../components/common/Panel';
import { gameStore, useGameState } from '../game/state/gameStore';
import { useI18n } from '../i18n/I18nProvider';
import { CLASS_PRESENTATION } from '../mock/outfitCatalog';

export function CharacterSelectScreen(): React.JSX.Element {
  const state = useGameState();
  const { signOut } = useAuth();
  const { t } = useI18n();
  const character = state.self;
  const map = state.map;

  if (!character || !map) {
    return <div />;
  }
  const classInfo = CLASS_PRESENTATION[character.characterClass];

  return (
    <main className="auth-background flex h-dvh items-center justify-center overflow-y-auto p-5 text-slate-100">
      <Panel elevated className="w-full max-w-4xl overflow-hidden">
        <header className="flex items-start justify-between gap-4 border-b border-white/10 p-6 sm:p-8">
          <div>
            <p className="eyebrow">{state.realm?.name ?? 'Game realm'}</p>
            <h1 className="font-display mt-2 text-3xl text-amber-100">{t('character.selectTitle')}</h1>
            <p className="mt-2 text-sm text-slate-400">{t('character.singleRealmNotice')}</p>
          </div>
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <Button variant="ghost" onClick={() => void signOut()} type="button">
              {t('hud.signOut')}
            </Button>
          </div>
        </header>

        <section className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="character-pedestal">
            <OutfitPreview
              outfitKey={character.outfitKey}
              characterClass={character.characterClass}
            />
          </div>

          <div className="flex flex-col justify-center">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="font-display text-4xl text-slate-50">{character.name}</h2>
              <span className={`zone-badge zone-${map.zoneType.toLowerCase()}`}>
                {map.zoneType}
              </span>
            </div>
            <p className={`mt-2 text-sm font-semibold uppercase tracking-[0.18em] ${classInfo.accent}`}>
              Level {character.level} {classInfo.label}
            </p>
            <div className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <Info label={t('common.map')} value={map.name} />
              <Info label={t('common.position')} value={`${character.x}, ${character.y}`} />
              <Info label="Outfit" value={character.outfitKey} />
              <Info label="Realm" value={state.realm?.slug ?? 'world-1'} />
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <Meter label="Health" value={character.hp} max={character.maxHp} tone="health" />
              <Meter label="Energy" value={character.energy} max={character.maxEnergy} tone="energy" />
            </div>
            <Button className="mt-8 justify-center py-3 text-base" onClick={() => gameStore.enterWorld()} type="button">
              {t('character.enterWorld')}
            </Button>
          </div>
        </section>
      </Panel>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950/40 p-3">
      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-200" title={value}>{value}</p>
    </div>
  );
}

function Meter({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'health' | 'energy' }): React.JSX.Element {
  const percentage = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-slate-400">
        <span>{label}</span><span>{value} / {max}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-950">
        <div className={`h-full ${tone === 'health' ? 'bg-rose-500' : 'bg-sky-500'}`} style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
