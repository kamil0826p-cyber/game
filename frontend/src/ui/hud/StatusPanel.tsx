import { OutfitPreview } from '../../components/common/OutfitPreview';
import type { MapStatePayload, SelfCharacterState } from '../../contracts/game';
import { useI18n } from '../../i18n/I18nProvider';

interface StatusPanelProps {
  character: SelfCharacterState;
  map: MapStatePayload;
}

export function StatusPanel({ character, map }: StatusPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const experienceTarget = Math.max(100, character.level * 250);
  const experiencePercent = Math.min(100, (character.experience / experienceTarget) * 100);

  return (
    <section className="player-dossier pointer-events-none" aria-label="Player status">
      <div className="player-dossier-accent" />
      <div className="player-portrait">
        <OutfitPreview outfitKey={character.outfitKey} characterClass={character.characterClass} size="small" animated />
        <span className="player-level">{character.level}</span>
      </div>
      <div className="player-dossier-main">
        <div className="player-dossier-heading">
          <div>
            <p>{character.characterClass}</p>
            <h2>{character.name}</h2>
          </div>
          <span className={`zone-badge zone-${map.zoneType.toLowerCase()}`}>{map.zoneType}</span>
        </div>
        <Meter label={t('hud.health')} value={character.hp} max={character.maxHp} tone="health" />
        <Meter label={t('hud.energy')} value={character.energy} max={character.maxEnergy} tone="energy" />
        <Meter label={t('hud.experience')} value={character.experience} max={experienceTarget} tone="xp" percent={experiencePercent} />
        <div className="player-location">
          <span>{map.name}</span>
          <code>{character.x}:{character.y}</code>
        </div>
      </div>
    </section>
  );
}

function Meter({ label, value, max, tone, percent }: { label: string; value: number; max: number; tone: 'health' | 'energy' | 'xp'; percent?: number }): React.JSX.Element {
  const width = percent ?? (max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0);
  return (
    <div className={`hud-meter hud-meter-${tone}`}>
      <div><span>{label}</span><strong>{value}<small> / {max}</small></strong></div>
      <div className="hud-meter-track"><i style={{ width: `${width}%` }} /></div>
    </div>
  );
}
