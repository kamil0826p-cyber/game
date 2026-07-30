import type { CombatActionResolutionPayload } from '../../contracts/socket';
import {
  actionDamageFor,
  getCombatVfxFamily,
  isSelfCastCombatAction,
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

function pointStyle(position: CombatStagePosition): React.CSSProperties {
  return { left: `${position.x}%`, top: `${position.y}%` };
}

function FloatingResult({
  action,
  target,
}: {
  action: CombatActionResolutionPayload;
  target: PositionedCombatant;
}): React.JSX.Element | null {
  const result = action.results.find((candidate) => candidate.targetActorId === target.actorId);
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
      style={pointStyle(target.position)}
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
  const family = getCombatVfxFamily(action);
  const target = primaryTarget ?? targets[0] ?? actor;
  const rootStyle = {
    '--combat-accent': action.visual.accentColor,
    '--combat-travel-ms': `${action.visual.travelMs ?? 420}ms`,
  } as React.CSSProperties;
  const projectileStyle = {
    '--combat-from-x': `${actor.position.x}%`,
    '--combat-from-y': `${actor.position.y - 7}%`,
    '--combat-to-x': `${target.position.x}%`,
    '--combat-to-y': `${target.position.y - 7}%`,
    '--combat-projectile-facing': target.position.x >= actor.position.x ? 1 : -1,
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
            ...pointStyle(actor.position),
            right: 'auto',
            bottom: 'auto',
            transform: 'translate(-50%, -68%)',
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
          <div className="combat-dynamic-cast-rune" style={pointStyle(actor.position)} />
          <div className="combat-dynamic-projectile" style={projectileStyle}>
            <i />
            <i />
            <i />
          </div>
          {targets.map((combatant) => (
            <div key={combatant.actorId}>
              <div className="combat-dynamic-impact-burst" style={pointStyle(combatant.position)}>
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="combat-dynamic-shockwave" style={pointStyle(combatant.position)} />
            </div>
          ))}
        </>
      )}
      {targets.map((combatant) => (
        <FloatingResult key={combatant.actorId} action={action} target={combatant} />
      ))}
    </div>
  );
}
