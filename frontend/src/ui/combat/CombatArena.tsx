import { useEffect, useMemo, useReducer, useState } from 'react';
import { OutfitPreview } from '../../components/common/OutfitPreview';
import type { CombatParticipantPayload, CombatSnapshot } from '../../contracts/socket';
import type {
  CombatCommandAction,
  CombatLegalActionPayload,
} from '../../contracts/tacticalCombat';
import {
  combatAnimationDuration,
  combatAnimationReducer,
  INITIAL_COMBAT_ANIMATION_STATE,
} from '../../game/combat/combatAnimationQueue';
import {
  combatFormationSlots,
  combatTeams,
  isCombatantAlive,
  usesAttackMotion,
  type CombatStagePosition,
} from '../../game/combat/combatPresentation';
import {
  isCombatActionTargetReady,
  resolveCombatActionTarget,
} from '../../game/combat/combatTargeting';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { gameStore, useGameState } from '../../game/state/gameStore';
import { useI18n } from '../../i18n/I18nProvider';
import {
  COMBAT_SKILL_INTENT_EVENT,
  type CombatSkillIntent,
  ActionBar,
} from '../hud/ActionBar';
import { CombatVfx } from './CombatVfx';

interface CombatArenaProps {
  combat: CombatSnapshot;
  onChange: (combat: CombatSnapshot) => void;
  onClose: () => void;
}

const TACTICAL_LABELS: Record<
  Exclude<CombatCommandAction, 'BASIC_ATTACK' | 'SKILL'>,
  { pl: string; en: string; glyph: string }
> = {
  DEFEND: { pl: 'Obrona', en: 'Defend', glyph: '◈' },
  INTERCEPT: { pl: 'Osłoń', en: 'Protect', glyph: '♜' },
  TAUNT: { pl: 'Prowokuj', en: 'Taunt', glyph: '!' },
  INTERRUPT: { pl: 'Przerwij', en: 'Interrupt', glyph: '✕' },
  CLEANSE: { pl: 'Oczyść', en: 'Cleanse', glyph: '✦' },
  MARK: { pl: 'Oznacz', en: 'Expose', glyph: '⌖' },
  COUNTER: { pl: 'Kontra', en: 'Counter', glyph: '↶' },
  REPOSITION: { pl: 'Zamień', en: 'Swap', glyph: '⇄' },
  TRANSFER_ENERGY: { pl: 'Energia', en: 'Energy', glyph: '◇' },
  SKIP: { pl: 'Czekaj', en: 'Hold', glyph: '…' },
};

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
  telegraphed,
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
  telegraphed: boolean;
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
      : participant.disconnected
        ? 'ROZŁĄCZONY'
        : undefined;
  const resistanceLabel = [
    participant.formationLine,
    participant.physicalDamageReduction !== undefined
      ? `FIZ ${Math.round(participant.physicalDamageReduction * 100)}%`
      : undefined,
    participant.magicalDamageReduction !== undefined
      ? `MAG ${Math.round(participant.magicalDamageReduction * 100)}%`
      : undefined,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <button
      type="button"
      className={`combat-stage-unit combat-stage-unit-${side} ${
        selected ? 'combat-stage-unit-selected' : ''
      } ${active ? 'combat-stage-unit-active' : ''} ${alive ? '' : 'combat-stage-unit-defeated'} ${
        targetable ? 'combat-stage-unit-targetable' : ''
      } ${telegraphed ? 'ring-2 ring-amber-200 ring-offset-2 ring-offset-black' : ''}`}
      style={style}
      disabled={!targetable}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${participant.name}. ${resistanceLabel}`}
      title={resistanceLabel}
      data-combat-actor-id={participant.actorId}
      data-formation-line={participant.formationLine}
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
        <ResourceBar
          value={participant.hp}
          maximum={participant.maxHp}
          type="health"
          compact
        />
        <ResourceBar
          value={participant.energy}
          maximum={participant.maxEnergy}
          type="energy"
          compact
        />
        <span className="combat-stage-markers">
          {local ? <em>TY</em> : null}
          {active ? <em>TURA</em> : null}
          {selected ? <em>CEL</em> : null}
          {telegraphed ? <em>ZAPOWIEDŹ</em> : null}
          {participant.guarding ? <em>OBRONA</em> : null}
          {participant.protectedByActorId ? <em>OSŁONA</em> : null}
          {participant.formationLine ? <em>{participant.formationLine}</em> : null}
          {participant.shield > 0 ? <em>◇{participant.shield}</em> : null}
          {(participant.controlDrStacks ?? 0) > 0 ? (
            <em>DR {participant.controlDrStacks}</em>
          ) : null}
          {participant.statuses.slice(0, 3).map((status) => (
            <em key={`${status.key}:${status.turnsRemaining}`}>
              {status.key} {status.turnsRemaining}
            </em>
          ))}
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
  const title =
    side === 'left'
      ? locale === 'pl'
        ? 'Twoja drużyna'
        : 'Your team'
      : locale === 'pl'
        ? 'Przeciwnicy'
        : 'Enemies';
  return (
    <div className={`combat-team-caption combat-team-caption-${side}`}>
      <strong>{title}</strong>
      <span>
        {alive} / {members.length}
      </span>
    </div>
  );
}

function CombatLog({ combat }: { combat: CombatSnapshot }): React.JSX.Element {
  const names = new Map(
    combat.participants.map((participant) => [participant.actorId, participant.name]),
  );
  return (
    <ol
      className="absolute bottom-[8.8rem] left-1/2 z-40 w-[min(38rem,44vw)] -translate-x-1/2 space-y-1 rounded-lg border border-white/5 bg-black/45 px-3 py-2 text-center backdrop-blur-sm"
      aria-live="polite"
    >
      {combat.recentActions.slice(-4).map((action) => {
        const totalDamage = action.results.reduce(
          (sum, result) => sum + Math.min(0, result.hpDelta),
          0,
        );
        const reaction = action.skillKey?.startsWith('tactical:');
        return (
          <li key={action.sequence} className="truncate text-[10px] text-slate-300">
            <span className="mr-2 text-amber-300/50">#{action.sequence}</span>
            <strong className="text-amber-100">{names.get(action.actorId)}</strong> ·{' '}
            {action.label}
            {reaction ? <span className="ml-1 text-cyan-200">REAKCJA</span> : null}
            {totalDamage < 0 ? (
              <span className="ml-1 text-rose-300">{totalDamage} HP</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

function actionKey(action: CombatLegalActionPayload): string {
  return `${action.action}:${action.skillKey ?? ''}`;
}

export function CombatArena({
  combat,
  onChange,
  onClose,
}: CombatArenaProps): React.JSX.Element | null {
  const connection = useGameConnection();
  const state = useGameState();
  const { t, locale } = useI18n();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [selectedTargetId, setSelectedTargetId] = useState<string>();
  const [reducedEffects, setReducedEffects] = useState(false);
  const [animation, dispatchAnimation] = useReducer(
    combatAnimationReducer,
    INITIAL_COMBAT_ANIMATION_STATE,
  );
  const animatedAction = animation.current;
  const teams = useMemo(
    () => (state.self ? combatTeams(combat, state.self.characterId) : undefined),
    [combat, state.self],
  );
  const participants = useMemo(
    () =>
      new Map(
        combat.participants.map((participant) => [participant.actorId, participant]),
      ),
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
      const slot = allySlots[participant.formationSlot ?? index];
      if (slot) positions.set(participant.actorId, slot);
    });
    teams.enemies.forEach((participant, index) => {
      const slot = enemySlots[participant.formationSlot ?? index];
      if (slot) positions.set(participant.actorId, slot);
    });
    return { allySlots, enemySlots, positions };
  }, [teams]);

  const ownActorId = teams?.own.actorId;
  const ownLegalActions = useMemo(
    () => (ownActorId ? combat.legalActionsByActorId?.[ownActorId] ?? [] : []),
    [combat.legalActionsByActorId, ownActorId],
  );
  const legalTargetIds = useMemo(
    () => new Set(ownLegalActions.flatMap((action) => action.targetActorIds)),
    [ownLegalActions],
  );
  const legalActionsBySkill = useMemo(
    () =>
      Object.fromEntries(
        ownLegalActions
          .filter((action) => action.action === 'SKILL' && action.skillKey)
          .map((action) => [action.skillKey!, action]),
      ),
    [ownLegalActions],
  );

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
    if (reducedEffects) {
      dispatchAnimation({ type: 'FINISH', sequence });
      return;
    }
    const timer = window.setTimeout(
      () => dispatchAnimation({ type: 'FINISH', sequence }),
      combatAnimationDuration(animatedAction),
    );
    return () => window.clearTimeout(timer);
  }, [animatedAction, reducedEffects]);

  useEffect(() => {
    if (!teams) return;
    setSelectedTargetId((current) => {
      if (current && legalTargetIds.has(current)) return current;
      const basic = ownLegalActions.find((action) => action.action === 'BASIC_ATTACK');
      return basic?.targetActorIds[0] ?? ownLegalActions[0]?.targetActorIds[0];
    });
  }, [combat.combatId, combat.turnNumber, legalTargetIds, ownLegalActions, teams]);

  const selectedTarget = selectedTargetId
    ? participants.get(selectedTargetId)
    : undefined;
  const isOwnDecision = Boolean(
    teams && combat.phase !== 'REACTION' && combat.activeActorId === teams.own.actorId,
  );
  const canReact = ownLegalActions.some((action) => action.reactionOnly);
  const canIssueCommand = isOwnDecision || canReact;

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

  const findLegalAction = (
    action: CombatCommandAction,
    skillKey?: string,
  ): CombatLegalActionPayload | undefined =>
    ownLegalActions.find(
      (candidate) =>
        candidate.action === action &&
        (action !== 'SKILL' || candidate.skillKey === skillKey),
    );

  const perform = (action: CombatCommandAction, skillKey?: string): void => {
    if (!canIssueCommand || busy || combat.status !== 'ACTIVE') return;
    const legal = findLegalAction(action, skillKey);
    if (!legal) return;
    const target = resolveCombatActionTarget(legal, selectedTargetId);
    if (!target.ready) {
      gameStore.addNotification({
        code: 'COMBAT_TARGET_REQUIRED',
        message:
          locale === 'pl'
            ? 'Zaznacz cel odpowiedni dla wybranej akcji.'
            : 'Select a valid target for the chosen action.',
      });
      setSelectedTargetId(undefined);
      return;
    }
    void mutate(() =>
      connection.performTeamCombatAction(
        combat.combatId,
        action,
        target.targetActorId,
        skillKey,
        combat.turnNumber,
      ),
    );
  };

  useEffect(() => {
    const useSkill = (event: Event) => {
      const detail = (event as CustomEvent<CombatSkillIntent>).detail;
      if (!detail || !isOwnDecision || busy || combat.status !== 'ACTIVE') return;
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
        !isOwnDecision ||
        busy ||
        combat.status !== 'ACTIVE'
      ) {
        return;
      }
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
    activeParticipant &&
      teams.allies.some((member) => member.actorId === activeParticipant.actorId),
  );
  const phaseReadyAt =
    combat.phase === 'REACTION'
      ? combat.telegraph?.startedAt
      : combat.turnStartedAt;
  const waitingForPresentation = Boolean(phaseReadyAt && now < phaseReadyAt);
  const effectiveNow = phaseReadyAt ? Math.max(now, phaseReadyAt) : now;
  const remainingMs = Math.max(0, (combat.turnEndsAt ?? effectiveNow) - effectiveNow);
  const phaseDuration =
    combat.phase === 'REACTION'
      ? combat.timing?.reactionMs ?? 12_000
      : combat.timing?.decisionMs ?? 10_000;
  const turnPercent = Math.max(
    0,
    Math.min(100, (remainingMs / Math.max(1, phaseDuration)) * 100),
  );
  const attackMotion = !reducedEffects && usesAttackMotion(animatedAction);
  const damagingTarget = (actorId: string): boolean =>
    Boolean(
      !reducedEffects &&
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
  const actionTargetId =
    animatedAction?.targetActorId ?? animatedAction?.results[0]?.targetActorId;
  const actionTarget = actionTargetId
    ? participants.get(actionTargetId)
    : selectedTarget;
  const positionedActor =
    actionActor && battlefield.positions.get(actionActor.actorId)
      ? {
          actorId: actionActor.actorId,
          position: battlefield.positions.get(actionActor.actorId)!,
        }
      : undefined;
  const positionedPrimaryTarget =
    actionTarget && battlefield.positions.get(actionTarget.actorId)
      ? {
          actorId: actionTarget.actorId,
          position: battlefield.positions.get(actionTarget.actorId)!,
        }
      : undefined;
  const positionedTargets = animatedAction
    ? [...new Set(animatedAction.results.map((result) => result.targetActorId))].flatMap(
        (actorId) => {
          const position = battlefield.positions.get(actorId);
          return position ? [{ actorId, position }] : [];
        },
      )
    : [];

  const turnLabel =
    combat.status === 'ACTIVE'
      ? waitingForPresentation
        ? locale === 'pl'
          ? 'Przygotowanie akcji'
          : 'Preparing action'
        : combat.phase === 'REACTION' && combat.telegraph
        ? locale === 'pl'
          ? `Reakcja: ${combat.telegraph.label}`
          : `Reaction: ${combat.telegraph.label}`
        : isOwnDecision
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
  const basicAction = findLegalAction('BASIC_ATTACK');
  const tacticalActions = ownLegalActions.filter(
    (action): action is CombatLegalActionPayload & {
      action: Exclude<CombatCommandAction, 'BASIC_ATTACK' | 'SKILL'>;
    } => action.action !== 'BASIC_ATTACK' && action.action !== 'SKILL',
  );
  const nextActor = combat.nextActorId
    ? participants.get(combat.nextActorId)
    : undefined;
  const queue = combat.turnQueue ?? [];
  const activeQueueIndex = combat.activeActorId
    ? queue.indexOf(combat.activeActorId)
    : -1;
  const upcomingQueue = Array.from(
    { length: Math.min(5, Math.max(0, queue.length - 1)) },
    (_, offset) => queue[(activeQueueIndex + offset + 1 + queue.length) % queue.length],
  )
    .map((actorId) => participants.get(actorId))
    .filter(
      (entry): entry is CombatParticipantPayload =>
        Boolean(entry && isCombatantAlive(entry)),
    );

  return (
    <div className="combat-arena-root" style={arenaStyle}>
      <div className="combat-arena-backdrop" />
      <div className={`combat-atmosphere ${reducedEffects ? 'opacity-20' : ''}`}>
        <i />
        <i />
        <i />
        <i />
      </div>
      <header className="combat-turn-banner">
        <span>{t('combat.round', { round: combat.turnNumber })}</span>
        <strong>{turnLabel}</strong>
        {nextActor ? (
          <small>{locale === 'pl' ? `Następny: ${nextActor.name}` : `Next: ${nextActor.name}`}</small>
        ) : null}
        {upcomingQueue.length > 0 ? (
          <small aria-label={locale === 'pl' ? 'Kolejka tur' : 'Turn queue'}>
            {locale === 'pl' ? 'Kolejka' : 'Queue'}: {' '}
            {upcomingQueue.map((entry) => entry.name).join(' → ')}
          </small>
        ) : null}
        {combat.status === 'ACTIVE' ? (
          <>
            <small>{Math.ceil(remainingMs / 1_000)}s</small>
            <div className="combat-turn-timer">
              <span />
            </div>
          </>
        ) : null}
        <button
          type="button"
          className="rounded border border-amber-200/30 bg-black/40 px-2 py-1 text-[9px] text-amber-100"
          aria-pressed={reducedEffects}
          onClick={() => setReducedEffects((current) => !current)}
        >
          {locale === 'pl' ? 'Efekty' : 'Effects'}: {reducedEffects ? 'LOW' : 'FULL'}
        </button>
      </header>

      {combat.telegraph ? (
        <div
          className="absolute left-1/2 top-24 z-50 -translate-x-1/2 rounded border border-amber-300/60 bg-black/80 px-4 py-2 text-center text-xs text-amber-100"
          role="status"
        >
          <strong>{combat.telegraph.label}</strong>
          <span className="ml-2">
            {locale === 'pl' ? 'okno reakcji' : 'reaction window'}{' '}
            {Math.ceil(Math.max(0, combat.telegraph.resolvesAt - now) / 1_000)}s
          </span>
        </div>
      ) : null}

      <div className="combat-stage-field">
        <TeamCaption side="left" members={teams.allies} locale={locale} />
        <TeamCaption side="right" members={teams.enemies} locale={locale} />
        <div className="combat-stage-divider" aria-hidden="true" />

        {teams.allies.map((participant) => {
          const position = battlefield.positions.get(participant.actorId);
          if (!position) return null;
          return (
            <BattlefieldUnit
              key={participant.actorId}
              participant={participant}
              position={position}
              side="left"
              active={participant.actorId === combat.activeActorId}
              selected={participant.actorId === selectedTarget?.actorId}
              targetable={
                combat.status === 'ACTIVE' &&
                isCombatantAlive(participant) &&
                legalTargetIds.has(participant.actorId)
              }
              attacking={Boolean(
                attackMotion && animatedAction?.actorId === participant.actorId,
              )}
              hit={damagingTarget(participant.actorId)}
              local={participant.actorId === teams.own.actorId}
              telegraphed={combat.telegraph?.actorId === participant.actorId}
              onSelect={() => setSelectedTargetId(participant.actorId)}
            />
          );
        })}

        {teams.enemies.map((participant) => {
          const position = battlefield.positions.get(participant.actorId);
          if (!position) return null;
          return (
            <BattlefieldUnit
              key={participant.actorId}
              participant={participant}
              position={position}
              side="right"
              active={participant.actorId === combat.activeActorId}
              selected={participant.actorId === selectedTarget?.actorId}
              targetable={
                combat.status === 'ACTIVE' &&
                isCombatantAlive(participant) &&
                legalTargetIds.has(participant.actorId)
              }
              attacking={Boolean(
                attackMotion && animatedAction?.actorId === participant.actorId,
              )}
              hit={damagingTarget(participant.actorId)}
              local={false}
              telegraphed={combat.telegraph?.actorId === participant.actorId}
              onSelect={() => setSelectedTargetId(participant.actorId)}
            />
          );
        })}

        {!reducedEffects ? (
          <CombatVfx
            action={animatedAction}
            actor={positionedActor}
            primaryTarget={positionedPrimaryTarget}
            targets={positionedTargets}
          />
        ) : null}
      </div>

      <CombatLog combat={combat} />

      {combat.status === 'ACTIVE' ? (
        <footer className="combat-controls">
          <button
            type="button"
            className="combat-basic-attack"
            disabled={
              !isOwnDecision ||
              busy ||
              !isCombatActionTargetReady(basicAction, selectedTargetId)
            }
            onClick={() => perform('BASIC_ATTACK')}
            title={
              basicAction
                ? isCombatActionTargetReady(basicAction, selectedTargetId)
                  ? `${locale === 'pl' ? 'Legalne cele' : 'Legal targets'}: ${basicAction.targetActorIds.length}`
                  : locale === 'pl'
                    ? 'Zaznacz przeciwnika, którego chcesz zaatakować.'
                    : 'Select the enemy you want to attack.'
                : undefined
            }
          >
            <span>⚔</span>
            <strong>{t('combat.action.basic')}</strong>
            <kbd>0</kbd>
          </button>
          <ActionBar
            disabled={!isOwnDecision || busy}
            disabledLabel={t('combat.turn.wait')}
            legalActionsBySkill={legalActionsBySkill}
            selectedTargetId={selectedTargetId}
          />
          <div className="flex max-w-[34rem] flex-wrap justify-center gap-1">
            {tacticalActions.map((action) => {
              const details = TACTICAL_LABELS[action.action];
              const targetReady = isCombatActionTargetReady(action, selectedTargetId);
              return (
                <button
                  key={actionKey(action)}
                  type="button"
                  className="rounded border border-amber-200/40 bg-black/65 px-2 py-1 text-[10px] font-semibold text-amber-100 disabled:opacity-40"
                  disabled={busy || !targetReady}
                  onClick={() => perform(action.action)}
                  title={
                    targetReady
                      ? `${details[locale]} · ${
                          locale === 'pl' ? 'legalne cele' : 'legal targets'
                        }: ${action.targetActorIds.length}`
                      : locale === 'pl'
                        ? 'Zaznacz cel odpowiedni dla tej akcji.'
                        : 'Select a valid target for this action.'
                  }
                >
                  <span className="mr-1" aria-hidden="true">
                    {details.glyph}
                  </span>
                  {details[locale]}
                </button>
              );
            })}
          </div>
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
