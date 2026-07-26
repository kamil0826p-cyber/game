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
    <main className="auth-background character-gateway">
      <header className="gateway-topbar">
        <div className="brand-mark"><span>EO</span></div>
        <div><small>{state.realm?.name ?? 'Game realm'}</small><strong>{t('character.selectTitle')}</strong></div>
        <LocaleToggle />
        <Button variant="ghost" onClick={() => void signOut()} type="button">{t('hud.signOut')}</Button>
      </header>

      <section className="gateway-layout">
        <div className="gateway-hero-stage">
          <div className="gateway-grid" />
          <div className="gateway-ring" />
          <OutfitPreview outfitKey={character.outfitKey} characterClass={character.characterClass} />
          <span className="gateway-class-tag">{classInfo.label}</span>
        </div>

        <article className="gateway-profile">
          <p className="entry-kicker">ACTIVE CHARACTER</p>
          <div className="gateway-name-row">
            <h1>{character.name}</h1>
            <span className={`zone-badge zone-${map.zoneType.toLowerCase()}`}>{map.zoneType}</span>
          </div>
          <p className="gateway-role">LEVEL {character.level} · {classInfo.role}</p>
          <p className="gateway-description">{classInfo.description}</p>
          <div className="gateway-data-grid">
            <Info label={t('common.map')} value={map.name} />
            <Info label={t('common.position')} value={`${character.x}:${character.y}`} />
            <Info label="Realm" value={state.realm?.slug ?? 'world-1'} />
            <Info label="Outfit" value={character.outfitKey} />
          </div>
          <div className="gateway-vitals">
            <Meter label="Health" value={character.hp} max={character.maxHp} tone="health" />
            <Meter label="Energy" value={character.energy} max={character.maxEnergy} tone="energy" />
          </div>
          <Button className="gateway-enter" onClick={() => gameStore.enterWorld()} type="button">{t('character.enterWorld')}</Button>
          <p className="gateway-note">{t('character.singleRealmNotice')}</p>
        </article>
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }): React.JSX.Element {
  return <div className="gateway-info"><span>{label}</span><strong title={value}>{value}</strong></div>;
}

function Meter({ label, value, max, tone }: { label: string; value: number; max: number; tone: 'health' | 'energy' }): React.JSX.Element {
  const percentage = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className={`gateway-meter gateway-meter-${tone}`}>
      <div><span>{label}</span><strong>{value} / {max}</strong></div>
      <i><b style={{ width: `${percentage}%` }} /></i>
    </div>
  );
}
