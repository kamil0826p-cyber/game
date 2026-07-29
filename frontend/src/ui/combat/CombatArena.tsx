import { useEffect, useMemo, useReducer, useState } from 'react';
import { OutfitPreview } from '../../components/common/OutfitPreview';
import type { CombatParticipantPayload, CombatSnapshot } from '../../contracts/socket';
import {
  combatAnimationDuration,
  combatAnimationReducer,
  INITIAL_COMBAT_ANIMATION_STATE,
} from '../../game/combat/combatAnimationQueue';
import { combatSides } from '../../game/combat/combatPresentation';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { useGameState } from '../../game/state/gameStore';
import { COMBAT_SKILL_INTENT_EVENT, type CombatSkillIntent, ActionBar } from '../hud/ActionBar';
import { useI18n } from '../../i18n/I18nProvider';
import { CombatVfx } from './CombatVfx';

interface CombatArenaProps {
  combat: CombatSnapshot;
  onChange: (combat: CombatSnapshot) => void;
  onClose: () => void;
}

const statusNames: Record<string, { en: string; pl: string }> = {
  BLEED: { en: 'Bleeding', pl: 'Krwawienie' },
  BURN: { en: 'Burning', pl: 'Podpalenie' },
  DAMAGE_INCREASE: { en: 'Empowered', pl: 'Wzmocnienie' },
  DAMAGE_REDUCTION: { en: 'Guarded', pl: 'Ochrona' },
  DAMAGE_TAKEN_INCREASE: { en: 'Marked', pl: 'Oznaczenie' },
  DODGE: { en: 'Evasion', pl: 'Unik' },
  HASTE: { en: 'Haste', pl: 'Przyspieszenie' },
  ROOTED: { en: 'Rooted', pl: 'Unieruchomienie' },
  SHIELD: { en: 'Shield', pl: 'Tarcza' },
  SLOWED: { en: 'Slowed', pl: 'Spowolnienie' },
  STUNNED: { en: 'Stunned', pl: 'Ogłuszenie' },
};
const editable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

function ResourceBar({
  value,
  maximum,
  type,
}: {
  value: number;
  maximum: number;
  type: 'health' | 'energy';
}): React.JSX.Element {
  const percent = Math.max(0, Math.min(100, (value / Math.max(1, maximum)) * 100));
  return (
    <div className={`combat-resource combat-resource-${type}`}>
      <span style={{ width: `${percent}%` }} />
      <strong>
        {value} / {maximum}
      </strong>
    </div>
  );
}

function CombatantPanel({
  participant,
  active,
  side,
}: {
  participant: CombatParticipantPayload;
  active: boolean;
  side: 'left' | 'right';
}): React.JSX.Element {
  const { locale } = useI18n();
  return (
    <section
      className={`combatant-panel combatant-panel-${side} ${active ? 'combatant-panel-active' : ''}`}
    >
      <div className="combatant-heading">
        <span>Lv. {participant.level}</span>
        <strong>{participant.name}</strong>
      </div>
      <ResourceBar value={participant.hp} maximum={participant.maxHp} type="health" />
      <ResourceBar value={participant.energy} maximum={participant.maxEnergy} type="energy" />
      <div className="combat-status-row">
        {participant.shield > 0 ? <span title={`Shield ${participant.shield}`}>◇</span> : null}
        {participant.statuses
          .filter((status) => status.key !== 'SHIELD')
          .map((status) => (
            <span key={`${status.key}-${status.turnsRemaining}`} title={status.key}>
              {statusNames[status.key]?.[locale] ?? status.key} · {status.turnsRemaining}
            </span>
          ))}
      </div>
    </section>
  );
}

function CombatLog({ combat }: { combat: CombatSnapshot }): React.JSX.Element {
  const participants = new Map(
    combat.participants.map((participant) => [participant.actorId, participant.name]),
  );
  return (
    <ol className="combat-log" aria-live="polite">
      {combat.recentActions.slice(-6).map((action) => {
        const result = action.results[0];
        const damage = result?.hpDelta && result.hpDelta < 0 ? ` ${result.hpDelta} HP` : '';
        return (
          <li key={action.sequence}>
            <span>{action.sequence}</span>
            <p>
              <strong>{participants.get(action.actorId)}</strong> · {action.label}
              {damage}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

export function CombatArena({
  combat,
  onChange,
  onClose,
}: CombatArenaProps): React.JSX.Element | null {
  const connection = useGameConnection();
  const state = useGameState();
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [animation, dispatchAnimation] = useReducer(
    combatAnimationReducer,
    INITIAL_COMBAT_ANIMATION_STATE,
  );
  const animatedAction = animation.current;
  const sides = state.self ? combatSides(combat, state.self.characterId) : undefined;

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

  const isOwnTurn = Boolean(sides && combat.activeActorId === sides.own.actorId);
  const remainingMs = Math.max(0, (combat.turnEndsAt ?? now) - now);
  const turnPercent = Math.max(0, Math.min(100, (remainingMs / 30_000) * 100));
  const actionActor = animatedAction?.actorId;
  const ownAnimating = sides?.own.actorId === actionActor;
  const opponentAnimating = sides?.opponent.actorId === actionActor;
  const damagingTarget = (actorId: string | undefined): boolean =>
    Boolean(
      actorId &&
        animatedAction?.results.some(
          (result) =>
            result.targetActorId === actorId &&
            (result.hpDelta < 0 || result.shieldAbsorbed > 0 || result.dodged),
        ),
    );
  const ownHit = damagingTarget(sides?.own.actorId);
  const opponentHit = damagingTarget(sides?.opponent.actorId);

  const mutate = async (operation: () => Promise<CombatSnapshot>): Promise<void> => {
    if (busy) return;
    setBusy(true);
    try {
      onChange(await operation());
    } catch {
      // Socket errors are displayed by the global notification layer.
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const useSkill = (event: Event) => {
      const detail = (event as CustomEvent<CombatSkillIntent>).detail;
      if (!detail || !isOwnTurn || busy || combat.status !== 'ACTIVE') return;
      void mutate(() =>
        connection.performCombatAction(combat.combatId, 'SKILL', detail.skillKey),
      );
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
      )
        return;
      event.preventDefault();
      void mutate(() => connection.performCombatAction(combat.combatId, 'BASIC_ATTACK'));
    };
    window.addEventListener('keydown', basicAttack);
    return () => window.removeEventListener('keydown', basicAttack);
  });

  const ownWon = sides?.own.actorId === combat.winnerActorId;
  const turnLabel =
    combat.status === 'ACTIVE'
      ? isOwnTurn
        ? t('combat.turn.yours')
        : t('combat.turn.enemy')
      : ownWon
        ? t('combat.result.victory')
        : t('combat.result.defeat');
  const arenaStyle = useMemo(
    () =>
      ({
        '--turn-progress': `${turnPercent}%`,
        '--combat-accent': animatedAction?.visual.accentColor ?? '#f5d88a',
      }) as React.CSSProperties,
    [animatedAction?.visual.accentColor, turnPercent],
  );

  if (!sides) return null;
  return (
    <div className="combat-arena-root" style={arenaStyle}>
      <div className="combat-arena-backdrop" />
      <div className="combat-atmosphere">
        <i />
        <i />
        <i />
        <i />
      </div>
      <header className="combat-turn-banner">
        <span>{t('combat.round', { round: combat.turnNumber })}</span>
        <strong>{turnLabel}</strong>
        {combat.status === 'ACTIVE' ? (
          <>
            <small>{Math.ceil(remainingMs / 1_000)}s</small>
            <div className="combat-turn-timer">
              <span />
            </div>
          </>
        ) : null}
      </header>

      <CombatantPanel
        participant={sides.own}
        active={combat.activeActorId === sides.own.actorId}
        side="left"
      />
      <CombatantPanel
        participant={sides.opponent}
        active={combat.activeActorId === sides.opponent.actorId}
        side="right"
      />

      <div
        className={`combat-character combat-character-left ${
          ownAnimating ? 'combat-character-attacking' : ''
        } ${ownHit ? 'combat-character-hit' : ''}`}
      >
        <div className="combat-character-aura" />
        <OutfitPreview
          outfitKey={sides.own.outfitKey}
          characterClass={sides.own.characterClass}
          direction="EAST"
          className="combat-outfit"
        />
        <span className="combat-ground-shadow" />
      </div>
      <div
        className={`combat-character combat-character-right ${
          opponentAnimating ? 'combat-character-attacking' : ''
        } ${opponentHit ? 'combat-character-hit' : ''}`}
      >
        <div className="combat-character-aura" />
        <OutfitPreview
          outfitKey={sides.opponent.outfitKey}
          characterClass={sides.opponent.characterClass}
          direction="WEST"
          className="combat-outfit"
        />
        <span className="combat-ground-shadow" />
      </div>

      <CombatVfx
        action={animatedAction}
        leftActorId={sides.own.actorId}
        rightActorId={sides.opponent.actorId}
      />
      <CombatLog combat={combat} />

      {combat.status === 'ACTIVE' ? (
        <footer className="combat-controls">
          <button
            type="button"
            className="combat-basic-attack"
            disabled={!isOwnTurn || busy}
            onClick={() =>
              void mutate(() => connection.performCombatAction(combat.combatId, 'BASIC_ATTACK'))
            }
          >
            <span>⚔</span>
            <strong>{t('combat.action.basic')}</strong>
            <kbd>0</kbd>
          </button>
          <ActionBar disabled={!isOwnTurn || busy} disabledLabel={t('combat.turn.wait')} />
          <button
            type="button"
            className="combat-forfeit-button"
            disabled={busy}
            onClick={() => void mutate(() => connection.leaveCombat(combat.combatId))}
          >
            {t('combat.action.forfeit')}
          </button>
        </footer>
      ) : (
        <div className={`combat-result-card ${ownWon ? 'combat-result-victory' : ''}`}>
          <span>{ownWon ? '♛' : '†'}</span>
          <h2>{turnLabel}</h2>
          <p>
            {ownWon
              ? t('combat.result.victoryCopy', { name: sides.opponent.name })
              : t('combat.result.defeatCopy', { name: sides.opponent.name })}
          </p>
          <button type="button" className="combat-primary-button" onClick={onClose}>
            {t('combat.result.return')}
          </button>
        </div>
      )}
    </div>
  );
}
