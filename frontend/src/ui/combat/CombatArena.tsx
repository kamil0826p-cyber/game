import { useEffect, useMemo, useReducer, useState } from 'react';
import { OutfitPreview } from '../../components/common/OutfitPreview';
import type { CombatParticipantPayload, CombatSnapshot } from '../../contracts/socket';
import {
  combatAnimationDuration,
  combatAnimationReducer,
  INITIAL_COMBAT_ANIMATION_STATE,
} from '../../game/combat/combatAnimationQueue';
import {
  combatFormationSlots,
  combatTeams,
  isCombatantAlive,
  selectCombatTarget,
  usesAttackMotion,
  type CombatStagePosition,
} from '../../game/combat/combatPresentation';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import { COMBAT_SKILL_INTENT_EVENT, type CombatSkillIntent, ActionBar } from '../hud/ActionBar';
import { CombatVfx } from './CombatVfx';

interface CombatArenaProps {
  combat: CombatSnapshot;
  onChange: (combat: CombatSnapshot) => void;
  onClose: () => void;
}

const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function ResourceBar({
  value,
  maximum,
  type,
  compact = false,
}: {
  value: number;
  maximum: number;
  type: 'health' | 'energy';
  compact?: boolean;
}): React.JSX.Element {
  const percent = Math.max(0, Math.min(100, (value / Math.max(1, maximum)) * 100));
  return (
    <div
      className={`${compact ? 'h-1.5' : 'h-2.5'} relative overflow-hidden rounded-sm border border-black/70 bg-black/70`}
    >
      <span
        className={`block h-full transition-[width] duration-300 ${
          type === 'health'
            ? 'bg-gradient-to-r from-rose-900 via-rose-600 to-rose-400'
            : 'bg-gradient-to-r from-sky-900 via-sky-600 to-cyan-400'
        }`}
        style={{ width: `${percent}%` }}
      />
      {!compact ? (
        <strong className="absolute inset-0 grid place-items-center text-[8px] font-semibold text-white/90 drop-shadow">
          {value} / {maximum}
        </strong>
      ) : null}
    </div>
  );
}

function BattlefieldUnit({
  participant,
  position,
  side,
  active,
  selected,
  targetable,
  attacking,
  hit,
  local,
  onSelect,
}: {
  participant: CombatParticipantPayload;
  position: CombatStagePosition;
  side: 'left' | 'right';
  active: boolean;
  selected: boolean;
  targetable: boolean;
  attacking: boolean;
  hit: boolean;
  local: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const alive = isCombatantAlive(participant);
  const defeatedMob = participant.kind === 'MOB' && !alive;
  const style = {
    left: `${position.x}%`,
    top: `${position.y}%`,
    zIndex: position.layer,
    '--combat-unit-scale': position.scale,
  } as React.CSSProperties;
  const stateLabel = participant.withdrawn
    ? 'WYCOFANY'
    : participant.hp <= 0
      ? 'POKONANY'
      : undefined;

  return (
    <button
      type="button"
      className={`combat-stage-unit combat-stage-unit-${side} ${
        selected ? 'combat-stage-unit-selected' : ''
      } ${active ? 'combat-stage-unit-active' : ''} ${alive ? '' : 'combat-stage-unit-defeated'} ${
        targetable ? 'combat-stage-unit-targetable' : ''
      }`}
      style={style}
      disabled={!targetable}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={participant.name}
      data-combat-actor-id={participant.actorId}
    >
      <span
        className={`combat-stage-actor ${
          attacking ? `combat-stage-actor-attacking-${side}` : ''
        } ${hit ? 'combat-stage-actor-hit' : ''}`}
      >
        <span className="combat-stage-aura" />
        {defeatedMob ? (
          <img
            src="/assets/mobs/mob-grave.svg"
            alt=""
            aria-hidden="true"
            className="combat-stage-outfit object-contain"
          />
        ) : (
          <OutfitPreview
            outfitKey={participant.outfitKey}
            characterClass={participant.characterClass}
            direction={side === 'left' ? 'EAST' : 'WEST'}
            renderScale={participant.renderScale ?? 1}
            animated={alive}
            className="combat-stage-outfit"
          />
        )}
        <span className="combat-stage-shadow" />
      </span>

      <span className="combat-stage-nameplate">
        <span className="combat-stage-name-row">
          <strong>{participant.name}</strong>
          <small>Lv. {participant.level}</small>
        </span>
        <ResourceBar value={participant.hp} maximum={participant.maxHp} type="health" compact />
        <ResourceBar value={participant.energy} maximum={participant.maxEnergy} type="energy" compact />
        <span className="combat-stage-markers">
          {local ? <em>TY</em> : null}
          {active ? <em>TURA</em> : null}
          {selected ? <em>CEL</em> : null}
          {participant.shield > 0 ? <em>◇{participant.shield}</em> : null}
          {stateLabel ? <em>{stateLabel}</em> : null}
        </span>
      </span>
    </button>
  );
}

function TeamCaption({
  side,
  members,
  locale,
}: {
  side: 'left' | 'right';
  members: readonly CombatParticipantPayload[];
  locale: 'pl' | 'en';
}): React.JSX.Element {
  const alive = members.filter(isCombatantAlive).length;
  const title = side === 'left'
    ? locale === 'pl' ? 'Twoja drużyna' : 'Your team'
    : locale === 'pl' ? 'Przeciwnicy' : 'Enemies';
  return (
    <div className={`combat-team-caption combat-team-caption-${side}`}>
      <strong>{title}</strong>
      <span>{alive} / {members.length}</span>
    </div>
  );
}

function CombatLog({ combat }: { combat: CombatSnapshot }): React.JSX.Element {
  const names = new Map(combat.participants.map((participant) => [participant.actorId, participant.name]));
  return (
    <ol
      className="absolute bottom-[7.2rem] left-1/2 z-40 w-[min(34rem,38vw)] -translate-x-1/2 space-y-1 rounded-lg border border-white/5 bg-black/45 px-3 py-2 text-center backdrop-blur-sm"
      aria-live="polite"
    >
      {combat.recentActions.slice(-4).map((action) => {
        const totalDamage = action.results.reduce(
          (sum, result) => sum + Math.min(0, result.hpDelta),
          0,
        );
        return (
          <li key={action.sequence} className="truncate text-[10px] text-slate-300">
            <span className="mr-2 text-amber-300/50">#{action.sequence}</span>
            <strong className="text-amber-100">{names.get(action.actorId)}</strong> · {action.label}
            {totalDamage < 0 ? <span className="ml-1 text-rose-300">{totalDamage} HP</span> : null}
          </li>
        );
      })}
    </ol>
  );
}

export function CombatArena({ combat, onChange, onClose }: CombatArenaProps): React.JSX.Element | null {
  const connection = useGameConnection();
  const state = useGameState();
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [animation, dispatchAnimation] = useReducer(
    combatAnimationReducer,
    INITIAL_COMBAT_ANIMATION_STATE,
  );
  const animatedAction = animation.current;
  const teams = useMemo(
    () => state.self ? combatTeams(combat, state.self.characterId) : undefined,
    [combat, state.self],
  );
  const participants = useMemo(
    () => new Map(combat.participants.map((participant) => [participant.actorId, participant])),
    [combat.participants],
  );
  const battlefield = useMemo(() => {
    if (!teams) {
      return {
        allySlots: [] as CombatStagePosition[],
        enemySlots: [] as CombatStagePosition[],
        positions: new Map<string, CombatStagePosition>(),
      };
    }
    const allySlots = combatFormationSlots(teams.allies.length, 'left');
    const enemySlots = combatFormationSlots(teams.enemies.length, 'right');
    const positions = new Map<string, CombatStagePosition>();
    teams.allies.forEach((participant, index) => {
      const slot = allySlots[index];
      if (slot) positions.set(participant.actorId, slot);
    });
    teams.enemies.forEach((participant, index) => {
      const slot = enemySlots[index];
      if (slot) positions.set(participant.actorId, slot);
    });
    return { allySlots, enemySlots, positions };
  }, [teams]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    dispatchAnimation({ type: 'SYNC', actions: combat.recentActions });
  }, [combat.recentActions]);

  useEffect(() => {
    if (!animatedAction) return;
    const sequence = animatedAction.sequence;
    const timer = window.setTimeout(
      () => dispatchAnimation({ type: 'FINISH', sequence }),
      combatAnimationDuration(animatedAction),
    );
    return () => window.clearTimeout(timer);
  }, [animatedAction]);

  useEffect(() => {
    if (!teams) return;
    setSelectedTargetId((current) => selectCombatTarget(teams.enemies, current)?.actorId);
  }, [combat.combatId, combat.turnNumber, teams]);

  const selectedTarget = teams ? selectCombatTarget(teams.enemies, selectedTargetId) : undefined;
  const isOwnTurn = Boolean(teams && combat.activeActorId === teams.own.actorId);

  const mutate = async (operation: () => Promise<CombatSnapshot>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      onChange(await operation());
    } catch {
      // Global socket notification.
    } finally {
      setBusy(false);
    }
  };

  const perform = (action: 'BASIC_ATTACK' | 'SKILL', skillKey?: string): void => {
    if (!selectedTarget || !isOwnTurn || busy || combat.status !== 'ACTIVE') return;
    void mutate(() =>
      connection.performTeamCombatAction(
        combat.combatId,
        action,
        selectedTarget.actorId,
        skillKey,
      ),
    );
  };

  useEffect(() => {
    const useSkill = (event: Event) => {
      const detail = (event as CustomEvent<CombatSkillIntent>).detail;
      if (!detail || !isOwnTurn || busy || combat.status !== 'ACTIVE') return;
      perform('SKILL', detail.skillKey);
    };
    window.addEventListener(COMBAT_SKILL_INTENT_EVENT, useSkill);
    return () => window.removeEventListener(COMBAT_SKILL_INTENT_EVENT, useSkill);
  });

  useEffect(() => {
    const basicAttack = (event: KeyboardEvent) => {
      if (
        event.key !== '0' ||
        event.repeat ||
        editable(event.target) ||
        !isOwnTurn ||
        busy ||
        combat.status !== 'ACTIVE'
      ) return;
      event.preventDefault();
      perform('BASIC_ATTACK');
    };
    window.addEventListener('keydown', basicAttack);
    return () => window.removeEventListener('keydown', basicAttack);
  });

  if (!teams) return null;
  const activeParticipant = combat.activeActorId
    ? participants.get(combat.activeActorId)
    : undefined;
  const activeIsAlly = Boolean(
    activeParticipant && teams.allies.some((member) => member.actorId === activeParticipant.actorId),
  );
  const remainingMs = Math.max(0, (combat.turnEndsAt ?? now) - now);
  const turnPercent = Math.max(0, Math.min(100, (remainingMs / 30_000) * 100));
  const attackMotion = usesAttackMotion(animatedAction);
  const damagingTarget = (actorId: string): boolean => Boolean(
    animatedAction?.results.some(
      (result) =>
        result.targetActorId === actorId &&
        (result.hpDelta < 0 || result.shieldAbsorbed > 0 || result.dodged),
    ),
  );
  const ownWon = combat.winnerTeamId
    ? combat.winnerTeamId === teams.ownTeamId
    : teams.allies.some((member) => member.actorId === combat.winnerActorId);

  const actionActor = animatedAction
    ? participants.get(animatedAction.actorId)
    : activeParticipant;
  const actionTargetId = animatedAction?.targetActorId ?? animatedAction?.results[0]?.targetActorId;
  const actionTarget = actionTargetId ? participants.get(actionTargetId) : selectedTarget;
  const positionedActor = actionActor && battlefield.positions.get(actionActor.actorId)
    ? { actorId: actionActor.actorId, position: battlefield.positions.get(actionActor.actorId)! }
    : undefined;
  const positionedPrimaryTarget = actionTarget && battlefield.positions.get(actionTarget.actorId)
    ? { actorId: actionTarget.actorId, position: battlefield.positions.get(actionTarget.actorId)! }
    : undefined;
  const positionedTargets = animatedAction
    ? [...new Set(animatedAction.results.map((result) => result.targetActorId))].flatMap((actorId) => {
        const position = battlefield.positions.get(actorId);
        return position ? [{ actorId, position }] : [];
      })
    : [];

  const turnLabel = combat.status === 'ACTIVE'
    ? isOwnTurn
      ? t('combat.turn.yours')
      : activeIsAlly
        ? locale === 'pl'
          ? `Tura sojusznika: ${activeParticipant?.name ?? ''}`
          : `Ally turn: ${activeParticipant?.name ?? ''}`
        : locale === 'pl'
          ? `Tura przeciwnika: ${activeParticipant?.name ?? ''}`
          : `Enemy turn: ${activeParticipant?.name ?? ''}`
    : ownWon
      ? t('combat.result.victory')
      : t('combat.result.defeat');

  const arenaStyle = {
    '--turn-progress': `${turnPercent}%`,
    '--combat-accent': animatedAction?.visual.accentColor ?? '#f5d88a',
  } as React.CSSProperties;

  return (
    <div className="combat-arena-root" style={arenaStyle}>
      <div className="combat-arena-backdrop" />
      <div className="combat-atmosphere"><i /><i /><i /><i /></div>
      <header className="combat-turn-banner">
        <span>{t('combat.round', { round: combat.turnNumber })}</span>
        <strong>{turnLabel}</strong>
        {combat.status === 'ACTIVE' ? (
          <>
            <small>{Math.ceil(remainingMs / 1_000)}s</small>
            <div className="combat-turn-timer"><span /></div>
          </>
        ) : null}
      </header>

      <div className="combat-stage-field">
        <TeamCaption side="left" members={teams.allies} locale={locale} />
        <TeamCaption side="right" members={teams.enemies} locale={locale} />
        <div className="combat-stage-divider" aria-hidden="true" />

        {teams.allies.map((participant, index) => {
          const position = battlefield.allySlots[index];
          if (!position) return null;
          return (
            <BattlefieldUnit
              key={participant.actorId}
              participant={participant}
              position={position}
              side="left"
              active={participant.actorId === combat.activeActorId}
              selected={false}
              targetable={false}
              attacking={Boolean(attackMotion && animatedAction?.actorId === participant.actorId)}
              hit={damagingTarget(participant.actorId)}
              local={participant.actorId === teams.own.actorId}
              onSelect={() => undefined}
            />
          );
        })}

        {teams.enemies.map((participant, index) => {
          const position = battlefield.enemySlots[index];
          if (!position) return null;
          return (
            <BattlefieldUnit
              key={participant.actorId}
              participant={participant}
              position={position}
              side="right"
              active={participant.actorId === combat.activeActorId}
              selected={participant.actorId === selectedTarget?.actorId}
              targetable={combat.status === 'ACTIVE' && isCombatantAlive(participant)}
              attacking={Boolean(attackMotion && animatedAction?.actorId === participant.actorId)}
              hit={damagingTarget(participant.actorId)}
              local={false}
              onSelect={() => setSelectedTargetId(participant.actorId)}
            />
          );
        })}

        <CombatVfx
          action={animatedAction}
          actor={positionedActor}
          primaryTarget={positionedPrimaryTarget}
          targets={positionedTargets}
        />
      </div>

      <CombatLog combat={combat} />

      {combat.status === 'ACTIVE' ? (
        <footer className="combat-controls">
          <button
            type="button"
            className="combat-basic-attack"
            disabled={!isOwnTurn || busy || !selectedTarget}
            onClick={() => perform('BASIC_ATTACK')}
          >
            <span>⚔</span><strong>{t('combat.action.basic')}</strong><kbd>0</kbd>
          </button>
          <ActionBar disabled={!isOwnTurn || busy} disabledLabel={t('combat.turn.wait')} />
          <button
            type="button"
            className="combat-forfeit-button"
            disabled={busy}
            onClick={() => void mutate(() => connection.leaveCombat(combat.combatId))}
          >
            {locale === 'pl' ? 'Wycofaj postać' : 'Withdraw'}
          </button>
        </footer>
      ) : (
        <div className={`combat-result-card ${ownWon ? 'combat-result-victory' : ''}`}>
          <span>{ownWon ? '♛' : '†'}</span>
          <h2>{turnLabel}</h2>
          <p>
            {ownWon
              ? locale === 'pl'
                ? 'Twoja drużyna pokonała wszystkich przeciwników.'
                : 'Your team defeated every opponent.'
              : locale === 'pl'
                ? 'Twoja drużyna została pokonana.'
                : 'Your team was defeated.'}
          </p>
          <button
            type="button"
            className="combat-primary-button px-7 py-2"
            onClick={onClose}
          >
            {t('combat.result.return')}
          </button>
        </div>
      )}
    </div>
  );
}
