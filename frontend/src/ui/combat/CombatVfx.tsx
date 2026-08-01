import type { CombatActionResolutionPayload } from '../../contracts/socket';
import {
  actionDamageFor,
  combatEffectPointForActor,
  getCombatVfxFamily,
  isSelfCastCombatAction,
  usesCombatProjectile,
  type CombatStagePosition,
} from '../../game/combat/combatPresentation';

interface PositionedCombatant {
  actorId: string;
  position: CombatStagePosition;
}

interface CombatVfxProps {
  action: CombatActionResolutionPayload | undefined;
  actor: PositionedCombatant | undefined;
  primaryTarget: PositionedCombatant | undefined;
  targets: PositionedCombatant[];
}

function effectPoint(combatant: PositionedCombatant): { x: number; y: number } {
  return combatEffectPointForActor(combatant.position, combatant.actorId);
}

function effectPointStyle(combatant: PositionedCombatant): React.CSSProperties {
  const point = effectPoint(combatant);
  return { left: `${point.x}%`, top: `${point.y}%` };
}

function FloatingResult({
  action,
  target,
}: {
  action: CombatActionResolutionPayload;
  target: PositionedCombatant;
}): React.JSX.Element | null {
  const result = action.results.find(
    (candidate) => candidate.targetActorId === target.actorId,
  );
  if (!result) return null;
  const damage = actionDamageFor(action, target.actorId);
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
      className={`combat-dynamic-floating-result ${
        healing || result.shieldDelta > 0 ? 'combat-floating-positive' : ''
      }`}
      style={effectPointStyle(target)}
    >
      {label}
    </span>
  );
}

export function CombatVfx({
  action,
  actor,
  primaryTarget,
  targets,
}: CombatVfxProps): React.JSX.Element | null {
  if (!action || !actor) return null;
  const support = isSelfCastCombatAction(action);
  const projectile = usesCombatProjectile(action);
  const family = getCombatVfxFamily(action);
  const target = primaryTarget ?? targets[0] ?? actor;
  const actorPoint = effectPoint(actor);
  const targetPoint = effectPoint(target);
  const rootStyle = {
    '--combat-accent': action.visual.accentColor,
    '--combat-travel-ms': `${action.visual.travelMs ?? 420}ms`,
  } as React.CSSProperties;
  const projectileStyle = {
    '--combat-from-x': `${actorPoint.x}%`,
    '--combat-from-y': `${actorPoint.y}%`,
    '--combat-to-x': `${targetPoint.x}%`,
    '--combat-to-y': `${targetPoint.y}%`,
    '--combat-projectile-facing': targetPoint.x >= actorPoint.x ? 1 : -1,
  } as React.CSSProperties;

  return (
    <div
      key={action.sequence}
      className={`combat-dynamic-vfx combat-vfx-${family}`}
      style={rootStyle}
      aria-hidden="true"
    >
      {support ? (
        <div
          className="combat-support-aura"
          style={{
            ...effectPointStyle(actor),
            right: 'auto',
            bottom: 'auto',
            transform: 'translate(-50%, -50%)',
          }}
        >
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
          <div
            className="combat-dynamic-cast-rune"
            style={effectPointStyle(actor)}
          />
          {projectile ? (
            <div className="combat-dynamic-projectile" style={projectileStyle}>
              <i />
              <i />
              <i />
            </div>
          ) : null}
          {targets.map((combatant) => (
            <div key={combatant.actorId}>
              <div
                className="combat-dynamic-impact-burst"
                style={effectPointStyle(combatant)}
              >
                <i />
                <i />
                <i />
                <i />
              </div>
              <div
                className="combat-dynamic-shockwave"
                style={effectPointStyle(combatant)}
              />
            </div>
          ))}
        </>
      )}
      {targets.map((combatant) => (
        <FloatingResult
          key={combatant.actorId}
          action={action}
          target={combatant}
        />
      ))}
    </div>
  );
}
