import { useEffect, useMemo, useReducer, useState } from 'react';
import { OutfitPreview } from '../../components/common/OutfitPreview';
import type { CombatParticipantPayload, CombatSnapshot } from '../../contracts/socket';
import {
  combatAnimationDuration,
  combatAnimationReducer,
  INITIAL_COMBAT_ANIMATION_STATE,
} from '../../game/combat/combatAnimationQueue';
import {
  combatRosterColumns,
  combatTeams,
  isCombatantAlive,
  selectCombatTarget,
  usesAttackMotion,
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

function ResourceBar({ value, maximum, type, compact = false }: {
  value: number;
  maximum: number;
  type: 'health' | 'energy';
  compact?: boolean;
}): React.JSX.Element {
  const percent = Math.max(0, Math.min(100, (value / Math.max(1, maximum)) * 100));
  return (
    <div className={`${compact ? 'h-1.5' : 'h-2.5'} relative overflow-hidden rounded-sm border border-black/70 bg-black/70`}>
      <span
        className={`block h-full transition-[width] duration-300 ${type === 'health' ? 'bg-gradient-to-r from-rose-900 via-rose-600 to-rose-400' : 'bg-gradient-to-r from-sky-900 via-sky-600 to-cyan-400'}`}
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

function RosterCard({ participant, active, selected, enemy, canSelect, onSelect }: {
  participant: CombatParticipantPayload;
  active: boolean;
  selected: boolean;
  enemy: boolean;
  canSelect: boolean;
  onSelect: () => void;
}): React.JSX.Element {
  const alive = isCombatantAlive(participant);
  return (
    <button
      type="button"
      disabled={!canSelect}
      onClick={onSelect}
      className={[
        'relative grid min-h-[64px] grid-cols-[42px_minmax(0,1fr)] items-center gap-2 overflow-hidden rounded-lg border px-2 py-1.5 text-left shadow-lg transition',
        enemy ? 'bg-gradient-to-br from-rose-950/85 to-slate-950/95' : 'bg-gradient-to-br from-emerald-950/75 to-slate-950/95',
        selected ? 'border-amber-300 ring-1 ring-amber-300/55' : active ? 'border-cyan-300/75 shadow-cyan-400/15' : 'border-white/10',
        alive ? '' : 'grayscale opacity-45',
        canSelect ? 'cursor-pointer hover:border-amber-200/70 hover:brightness-110' : 'cursor-default',
      ].join(' ')}
      aria-pressed={selected}
    >
      <div className="grid size-10 place-items-center overflow-hidden rounded-md border border-white/10 bg-black/45">
        <OutfitPreview
          outfitKey={participant.outfitKey}
          characterClass={participant.characterClass}
          direction={enemy ? 'WEST' : 'EAST'}
          renderScale={participant.renderScale ?? 1}
          size="small"
          animated={active && alive}
          className="!h-14 !w-10"
        />
      </div>
      <div className="min-w-0">
        <div className="flex items-center justify-between gap-1">
          <strong className="truncate text-[10px] text-amber-50">{participant.name}</strong>
          <span className="shrink-0 text-[8px] uppercase tracking-wider text-amber-200/55">Lv. {participant.level}</span>
        </div>
        <div className="mt-1 space-y-1">
          <ResourceBar value={participant.hp} maximum={participant.maxHp} type="health" compact />
          <ResourceBar value={participant.energy} maximum={participant.maxEnergy} type="energy" compact />
        </div>
        <div className="mt-1 flex h-3 items-center gap-1 overflow-hidden text-[8px] text-slate-400">
          {participant.shield > 0 ? <span title={`Shield ${participant.shield}`}>◇{participant.shield}</span> : null}
          {participant.withdrawn ? <span>WYCOFANY</span> : participant.hp <= 0 ? <span>POKONANY</span> : null}
          {participant.statuses.slice(0, 2).map((status) => (
            <span key={`${status.key}-${status.turnsRemaining}`} title={status.key}>{status.key.slice(0, 3)}·{status.turnsRemaining}</span>
          ))}
        </div>
      </div>
      {active ? <span className="absolute left-0 top-0 h-full w-0.5 bg-cyan-300 shadow-[0_0_10px_#67e8f9]" /> : null}
      {selected ? <span className="absolute right-1 top-1 text-[9px] text-amber-300">CEL</span> : null}
    </button>
  );
}

function TeamRoster({ title, members, activeActorId, selectedActorId, enemy, canSelect, onSelect }: {
  title: string;
  members: CombatParticipantPayload[];
  activeActorId?: string;
  selectedActorId?: string;
  enemy: boolean;
  canSelect: boolean;
  onSelect: (actorId: string) => void;
}): React.JSX.Element {
  const columns = combatRosterColumns(members.length);
  const alive = members.filter(isCombatantAlive).length;
  return (
    <section className={`absolute bottom-[7rem] top-[5rem] z-20 flex w-[min(29vw,30rem)] flex-col ${enemy ? 'right-4' : 'left-4'}`}>
      <header className={`mb-2 flex items-center gap-2 border-b border-amber-300/20 pb-1 ${enemy ? 'justify-end text-right' : ''}`}>
        <strong className="font-display text-sm uppercase tracking-[0.14em] text-amber-100">{title}</strong>
        <span className="text-[9px] uppercase tracking-wider text-slate-400">{alive}/{members.length}</span>
      </header>
      <div className={`grid min-h-0 flex-1 content-start gap-1.5 ${columns === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {members.map((participant) => (
          <RosterCard
            key={participant.actorId}
            participant={participant}
            active={participant.actorId === activeActorId}
            selected={participant.actorId === selectedActorId}
            enemy={enemy}
            canSelect={enemy && canSelect && isCombatantAlive(participant)}
            onSelect={() => onSelect(participant.actorId)}
          />
        ))}
      </div>
    </section>
  );
}

function StageCombatant({ participant, side, attacking, hit, defeatedMob }: {
  participant: CombatParticipantPayload;
  side: 'left' | 'right';
  attacking: boolean;
  hit: boolean;
  defeatedMob: boolean;
}): React.JSX.Element {
  return (
    <div
      className={`combat-character combat-character-${side} ${attacking ? 'combat-character-attacking' : ''} ${hit ? 'combat-character-hit' : ''}`}
      style={side === 'left' ? { left: '34%' } : { right: '34%' }}
    >
      <div className="combat-character-aura" />
      {defeatedMob ? (
        <img src="/assets/mobs/mob-grave.svg" alt="" aria-hidden="true" className="combat-outfit object-contain" />
      ) : (
        <OutfitPreview
          outfitKey={participant.outfitKey}
          characterClass={participant.characterClass}
          direction={side === 'left' ? 'EAST' : 'WEST'}
          renderScale={participant.renderScale ?? 1}
          className="combat-outfit"
        />
      )}
      <span className="combat-ground-shadow" />
      <div className="absolute -bottom-4 left-1/2 w-40 -translate-x-1/2 text-center">
        <strong className="block truncate font-display text-xs text-amber-100 drop-shadow">{participant.name}</strong>
        <div className="mt-1"><ResourceBar value={participant.hp} maximum={participant.maxHp} type="health" /></div>
      </div>
    </div>
  );
}

function CombatLog({ combat }: { combat: CombatSnapshot }): React.JSX.Element {
  const names = new Map(combat.participants.map((participant) => [participant.actorId, participant.name]));
  return (
    <ol className="absolute bottom-[7.2rem] left-1/2 z-20 w-[min(34rem,38vw)] -translate-x-1/2 space-y-1 rounded-lg border border-white/5 bg-black/35 px-3 py-2 text-center backdrop-blur-sm" aria-live="polite">
      {combat.recentActions.slice(-4).map((action) => {
        const totalDamage = action.results.reduce((sum, result) => sum + Math.min(0, result.hpDelta), 0);
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
  const [animation, dispatchAnimation] = useReducer(combatAnimationReducer, INITIAL_COMBAT_ANIMATION_STATE);
  const animatedAction = animation.current;
  const teams = useMemo(
    () => state.self ? combatTeams(combat, state.self.characterId) : undefined,
    [combat, state.self],
  );
  const participants = useMemo(() => new Map(combat.participants.map((participant) => [participant.actorId, participant])), [combat.participants]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { dispatchAnimation({ type: 'SYNC', actions: combat.recentActions }); }, [combat.recentActions]);
  useEffect(() => {
    if (!animatedAction) return;
    const sequence = animatedAction.sequence;
    const timer = window.setTimeout(() => dispatchAnimation({ type: 'FINISH', sequence }), combatAnimationDuration(animatedAction));
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
    try { onChange(await operation()); } catch { /* Global socket notification. */ } finally { setBusy(false); }
  };
  const perform = (action: 'BASIC_ATTACK' | 'SKILL', skillKey?: string): void => {
    if (!selectedTarget || !isOwnTurn || busy || combat.status !== 'ACTIVE') return;
    void mutate(() => connection.performTeamCombatAction(combat.combatId, action, selectedTarget.actorId, skillKey));
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
      if (event.key !== '0' || event.repeat || editable(event.target) || !isOwnTurn || busy || combat.status !== 'ACTIVE') return;
      event.preventDefault();
      perform('BASIC_ATTACK');
    };
    window.addEventListener('keydown', basicAttack);
    return () => window.removeEventListener('keydown', basicAttack);
  });

  if (!teams) return null;
  const activeParticipant = combat.activeActorId ? participants.get(combat.activeActorId) : undefined;
  const activeIsAlly = activeParticipant?.teamId === teams.ownTeamId || teams.allies.some((member) => member.actorId === activeParticipant?.actorId);
  const remainingMs = Math.max(0, (combat.turnEndsAt ?? now) - now);
  const turnPercent = Math.max(0, Math.min(100, (remainingMs / 30_000) * 100));

  const actionActor = animatedAction ? participants.get(animatedAction.actorId) : activeParticipant;
  const actionTargetId = animatedAction?.targetActorId ?? animatedAction?.results[0]?.targetActorId;
  const actionTarget = actionTargetId ? participants.get(actionTargetId) : selectedTarget;
  const actorOnOwnTeam = actionActor ? teams.allies.some((member) => member.actorId === actionActor.actorId) : true;
  const stageLeft = actorOnOwnTeam ? (actionActor ?? teams.own) : (actionTarget && teams.allies.some((member) => member.actorId === actionTarget.actorId) ? actionTarget : teams.own);
  const stageRight = actorOnOwnTeam ? (actionTarget && teams.enemies.some((member) => member.actorId === actionTarget.actorId) ? actionTarget : selectedTarget ?? teams.enemies[0]!) : (actionActor ?? selectedTarget ?? teams.enemies[0]!);
  const attackMotion = usesAttackMotion(animatedAction);
  const damagingTarget = (actorId: string): boolean => Boolean(animatedAction?.results.some((result) => result.targetActorId === actorId && (result.hpDelta < 0 || result.shieldAbsorbed > 0 || result.dodged)));
  const ownWon = combat.winnerTeamId
    ? combat.winnerTeamId === teams.ownTeamId
    : teams.allies.some((member) => member.actorId === combat.winnerActorId);

  const turnLabel = combat.status === 'ACTIVE'
    ? isOwnTurn
      ? t('combat.turn.yours')
      : activeIsAlly
        ? (locale === 'pl' ? `Tura sojusznika: ${activeParticipant?.name ?? ''}` : `Ally turn: ${activeParticipant?.name ?? ''}`)
        : (locale === 'pl' ? `Tura przeciwnika: ${activeParticipant?.name ?? ''}` : `Enemy turn: ${activeParticipant?.name ?? ''}`)
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
        {combat.status === 'ACTIVE' ? <><small>{Math.ceil(remainingMs / 1_000)}s</small><div className="combat-turn-timer"><span /></div></> : null}
      </header>

      <TeamRoster
        title={locale === 'pl' ? 'Twoja drużyna' : 'Your team'}
        members={teams.allies}
        activeActorId={combat.activeActorId}
        enemy={false}
        canSelect={false}
        onSelect={() => undefined}
      />
      <TeamRoster
        title={locale === 'pl' ? 'Przeciwnicy' : 'Enemies'}
        members={teams.enemies}
        activeActorId={combat.activeActorId}
        selectedActorId={selectedTarget?.actorId}
        enemy
        canSelect={combat.status === 'ACTIVE'}
        onSelect={setSelectedTargetId}
      />

      <StageCombatant
        participant={stageLeft}
        side="left"
        attacking={Boolean(attackMotion && animatedAction?.actorId === stageLeft.actorId)}
        hit={damagingTarget(stageLeft.actorId)}
        defeatedMob={combat.status === 'FINISHED' && stageLeft.kind === 'MOB' && stageLeft.hp <= 0}
      />
      <StageCombatant
        participant={stageRight}
        side="right"
        attacking={Boolean(attackMotion && animatedAction?.actorId === stageRight.actorId)}
        hit={damagingTarget(stageRight.actorId)}
        defeatedMob={combat.status === 'FINISHED' && stageRight.kind === 'MOB' && stageRight.hp <= 0}
      />
      <CombatVfx action={animatedAction} leftActorId={stageLeft.actorId} rightActorId={stageRight.actorId} />
      <CombatLog combat={combat} />

      {combat.status === 'ACTIVE' ? (
        <footer className="combat-controls">
          <button type="button" className="combat-basic-attack" disabled={!isOwnTurn || busy || !selectedTarget} onClick={() => perform('BASIC_ATTACK')}>
            <span>⚔</span><strong>{t('combat.action.basic')}</strong><kbd>0</kbd>
          </button>
          <ActionBar disabled={!isOwnTurn || busy} disabledLabel={t('combat.turn.wait')} />
          <button type="button" className="combat-forfeit-button" disabled={busy} onClick={() => void mutate(() => connection.leaveCombat(combat.combatId))}>
            {locale === 'pl' ? 'Wycofaj postać' : 'Withdraw'}
          </button>
        </footer>
      ) : (
        <div className={`combat-result-card ${ownWon ? 'combat-result-victory' : ''}`}>
          <span>{ownWon ? '♛' : '†'}</span>
          <h2>{turnLabel}</h2>
          <p>{ownWon
            ? (locale === 'pl' ? 'Twoja drużyna pokonała wszystkich przeciwników.' : 'Your team defeated every opponent.')
            : (locale === 'pl' ? 'Twoja drużyna została pokonana.' : 'Your team was defeated.')}</p>
          <button type="button" className="combat-primary-button px-7 py-2" onClick={onClose}>{t('combat.action.close')}</button>
        </div>
      )}
    </div>
  );
}
