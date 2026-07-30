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

function effectPointStyle(position: CombatStagePosition): React.CSSProperties {
  return { left: `${position.effectX}%`, top: `${position.effectY}%` };
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
      style={effectPointStyle(target.position)}
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
    '--combat-from-x': `${actor.position.effectX}%`,
    '--combat-from-y': `${actor.position.effectY}%`,
    '--combat-to-x': `${target.position.effectX}%`,
    '--combat-to-y': `${target.position.effectY}%`,
    '--combat-projectile-facing': target.position.effectX >= actor.position.effectX ? 1 : -1,
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
            ...effectPointStyle(actor.position),
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
          <div className="combat-dynamic-cast-rune" style={effectPointStyle(actor.position)} />
          <div className="combat-dynamic-projectile" style={projectileStyle}>
            <i />
            <i />
            <i />
          </div>
          {targets.map((combatant) => (
            <div key={combatant.actorId}>
              <div className="combat-dynamic-impact-burst" style={effectPointStyle(combatant.position)}>
                <i />
                <i />
                <i />
                <i />
              </div>
              <div className="combat-dynamic-shockwave" style={effectPointStyle(combatant.position)} />
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
