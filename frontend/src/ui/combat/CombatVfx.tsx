import type { CombatActionResolutionPayload } from '../../contracts/socket';
import {
  actionDamageFor,
  getCombatVfxFamily,
  isSelfCastCombatAction,
} from '../../game/combat/combatPresentation';

interface CombatVfxProps {
  action: CombatActionResolutionPayload | undefined;
  leftActorId: string;
  rightActorId: string;
}

function FloatingResult({
  action,
  actorId,
  side,
}: {
  action: CombatActionResolutionPayload;
  actorId: string;
  side: 'left' | 'right';
}): React.JSX.Element | null {
  const result = action.results.find((candidate) => candidate.targetActorId === actorId);
  if (!result) return null;
  const damage = actionDamageFor(action, actorId);
  const healing = result.hpDelta > 0 ? result.hpDelta : 0;
  const label = result.dodged
    ? 'DODGE'
    : damage
      ? String(damage)
      : healing
        ? `+${healing}`
        : result.shieldDelta > 0
          ? `+${result.shieldDelta} SHIELD`
          : '';
  if (!label) return null;
  return (
    <span
      className={`combat-floating-result combat-floating-result-${side} ${
        healing || result.shieldDelta > 0 ? 'combat-floating-positive' : ''
      }`}
    >
      {label}
    </span>
  );
}

export function CombatVfx({
  action,
  leftActorId,
  rightActorId,
}: CombatVfxProps): React.JSX.Element | null {
  if (!action) return null;
  const fromLeft = action.actorId === leftActorId;
  const support = isSelfCastCombatAction(action);
  const family = getCombatVfxFamily(action);
  const style = {
    '--combat-accent': action.visual.accentColor,
    '--combat-travel-ms': `${action.visual.travelMs ?? 420}ms`,
  } as React.CSSProperties;

  return (
    <div
      key={action.sequence}
      className={`combat-vfx combat-vfx-${family} ${
        fromLeft ? 'combat-vfx-left-to-right' : 'combat-vfx-right-to-left'
      }`}
      style={style}
      aria-hidden="true"
    >
      {support ? (
        <div className="combat-support-aura">
          <span className="combat-support-sigil" />
          <span className="combat-support-ring" />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : (
        <>
          <div className="combat-cast-rune" />
          <div className="combat-projectile">
            <i />
            <i />
            <i />
          </div>
          <div className="combat-impact-burst">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="combat-shockwave" />
        </>
      )}
      <FloatingResult action={action} actorId={leftActorId} side="left" />
      <FloatingResult action={action} actorId={rightActorId} side="right" />
    </div>
  );
}
