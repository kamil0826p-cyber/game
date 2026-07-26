import { OutfitPreview } from '../../components/common/OutfitPreview';
import type { MapStatePayload, SelfCharacterState } from '../../contracts/game';
import { useI18n } from '../../i18n/I18nProvider';

interface StatusPanelProps {
  character: SelfCharacterState;
  map: MapStatePayload;
}

const classLabelKey = {
  MAGE: 'class.mage',
  WARRIOR: 'class.warrior',
  ARCHER: 'class.archer',
} as const;

const zoneLabelKey = {
  SAFE: 'map.zone.safe',
  OUTLAW: 'map.zone.outlaw',
  PVP: 'map.zone.pvp',
} as const;

export function StatusPanel({ character, map }: StatusPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const experienceTarget = Math.max(100, character.level * 250);
  const experiencePercent = Math.min(100, (character.experience / experienceTarget) * 100);

  return (
    <section className="hud-panel pointer-events-none w-[min(390px,calc(100vw-24px))] p-3" aria-label="Player status">
      <div className="flex items-center gap-3">
        <div className="grid size-[74px] shrink-0 place-items-center overflow-hidden rounded-lg border border-amber-300/30 bg-slate-950/65">
          <OutfitPreview outfitKey={character.outfitKey} characterClass={character.characterClass} size="small" animated />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-display text-xl text-amber-100">{character.name}</h2>
              <p className="truncate text-[10px] uppercase tracking-[0.18em] text-slate-400">
                {t(classLabelKey[character.characterClass])} · {t('common.level')} {character.level}
              </p>
            </div>
            <span className={`zone-badge zone-${map.zoneType.toLowerCase()}`}>{t(zoneLabelKey[map.zoneType])}</span>
          </div>
          <Meter label={t('hud.health')} value={character.hp} max={character.maxHp} className="bg-rose-500" />
          <Meter label={t('hud.energy')} value={character.energy} max={character.maxEnergy} className="bg-sky-500" />
          <div className="mt-1.5">
            <div className="mb-0.5 flex justify-between text-[9px] uppercase tracking-wider text-slate-500">
              <span>{t('hud.experience')}</span><span>{character.experience} / {experienceTarget}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-black/50">
              <div className="h-full bg-amber-400" style={{ width: `${experiencePercent}%` }} />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-slate-400">
        <span className="truncate">{map.name}</span>
        <span className="font-mono">X {character.x} · Y {character.y}</span>
      </div>
    </section>
  );
}

function Meter({ label, value, max, className }: { label: string; value: number; max: number; className: string }): React.JSX.Element {
  const percent = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="mt-1.5">
      <div className="mb-0.5 flex justify-between text-[9px] uppercase tracking-wider text-slate-500">
        <span>{label}</span><span>{value} / {max}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full border border-black/40 bg-black/55">
        <div className={`h-full ${className}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
