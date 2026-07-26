import { OutfitPreview } from '../../components/common/OutfitPreview';
import type { MapStatePayload, SelfCharacterState } from '../../contracts/game';
import { useI18n } from '../../i18n/I18nProvider';

interface StatusPanelProps { character: SelfCharacterState; map: MapStatePayload; }

export function StatusPanel({ character, map }: StatusPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const experienceTarget = Math.max(100, character.level * 250);
  const experiencePercent = Math.min(100, (character.experience / experienceTarget) * 100);
  return (
    <section className="royal-hud-status pointer-events-none" aria-label="Player status">
      <div className="royal-hud-portrait"><OutfitPreview outfitKey={character.outfitKey} characterClass={character.characterClass} size="small" animated /><span>{character.level}</span></div>
      <div className="royal-hud-status-body">
        <div className="royal-hud-name"><div><h2>{character.name}</h2><p>{character.characterClass}</p></div><span className={`zone-badge zone-${map.zoneType.toLowerCase()}`}>{map.zoneType}</span></div>
        <Meter label={t('hud.health')} value={character.hp} max={character.maxHp} tone="health" />
        <Meter label={t('hud.energy')} value={character.energy} max={character.maxEnergy} tone="energy" />
        <Meter label={t('hud.experience')} value={character.experience} max={experienceTarget} tone="experience" percent={experiencePercent} />
        <div className="royal-hud-location"><span>{map.name}</span><b>X {character.x} · Y {character.y}</b></div>
      </div>
    </section>
  );
}

function Meter({ label, value, max, tone, percent }: { label: string; value: number; max: number; tone: 'health' | 'energy' | 'experience'; percent?: number }): React.JSX.Element {
  const width = percent ?? (max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0);
  return <div className="royal-hud-meter"><div><span>{label}</span><b>{value} / {max}</b></div><div><i className={tone} style={{ width: `${width}%` }} /></div></div>;
}