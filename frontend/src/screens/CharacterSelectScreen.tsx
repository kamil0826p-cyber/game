import { useAuth } from '../auth/AuthProvider';
import { Button } from '../components/common/Button';
import { LocaleToggle } from '../components/common/LocaleToggle';
import { OutfitPreview } from '../components/common/OutfitPreview';
import { gameStore, useGameState } from '../game/state/gameStore';
import { useI18n } from '../i18n/I18nProvider';
import { CLASS_PRESENTATION } from '../mock/outfitCatalog';

export function CharacterSelectScreen(): React.JSX.Element {
  const state = useGameState();
  const { signOut } = useAuth();
  const { t } = useI18n();
  const character = state.self;
  const map = state.map;
  if (!character || !map) return <div />;
  const classInfo = CLASS_PRESENTATION[character.characterClass];

  return (
    <main className="royal-select min-h-dvh overflow-y-auto text-stone-100">
      <header className="royal-select-header">
        <div><p className="royal-kicker">{state.realm?.name ?? 'Game realm'}</p><h1>{t('character.selectTitle')}</h1></div>
        <div className="flex items-center gap-2"><LocaleToggle /><Button variant="ghost" onClick={() => void signOut()} type="button">{t('hud.signOut')}</Button></div>
      </header>

      <section className="royal-throne-room">
        <div className="royal-banner royal-banner-left"><span>✦</span></div>
        <div className="royal-hero-pedestal">
          <div className="royal-halo" />
          <OutfitPreview outfitKey={character.outfitKey} characterClass={character.characterClass} />
          <span className={`zone-badge zone-${map.zoneType.toLowerCase()}`}>{map.zoneType}</span>
        </div>
        <div className="royal-banner royal-banner-right"><span>✦</span></div>
      </section>

      <section className="royal-character-record">
        <div className="royal-character-name"><p>{classInfo.role}</p><h2>{character.name}</h2><span>Level {character.level} {classInfo.label}</span></div>
        <div className="royal-record-grid">
          <Record label={t('common.map')} value={map.name} />
          <Record label={t('common.position')} value={`${character.x}, ${character.y}`} />
          <Record label="Outfit" value={character.outfitKey} />
          <Record label="Realm" value={state.realm?.slug ?? 'world-1'} />
        </div>
        <div className="royal-vitals">
          <Meter label="Health" value={character.hp} max={character.maxHp} tone="health" />
          <Meter label="Energy" value={character.energy} max={character.maxEnergy} tone="energy" />
        </div>
        <Button className="royal-enter-world" onClick={() => gameStore.enterWorld()} type="button">{t('character.enterWorld')}</Button>
      </section>
    </main>
  );
}

function Record({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="royal-record"><span>{label}</span><strong title={value}>{value}</strong></div>;
}

function Meter({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'health' | 'energy' }): React.JSX.Element {
  const percentage = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div className="royal-meter"><div><span>{label}</span><b>{value} / {max}</b></div><div className="royal-meter-track"><i className={tone} style={{ width: `${percentage}%` }} /></div></div>;
}