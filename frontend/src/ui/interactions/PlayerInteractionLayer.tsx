import { useEffect, useState } from 'react';
import type { PublicPlayerState } from '../../contracts/game';
import type { CombatSnapshot, TradeSnapshot } from '../../contracts/socket';
import { getPlayerCombatAvailability } from '../../game/combat/playerCombat';
import { PLAYER_CONTEXT_EVENT } from '../../game/engine/CharacterView';
import { canInteractWithPlayer } from '../../game/interactions/playerInteraction';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { gameStore, useGameState } from '../../game/state/gameStore';
import { canTradeWithPlayer } from '../../game/trade/playerTrade';
import { useI18n } from '../../i18n/I18nProvider';
import { CombatArena } from '../combat/CombatArena';
import { CombatRequestModal } from '../combat/CombatRequestModal';
import { TradeModal } from '../trade/TradeModal';
import { ActorContextMenu } from './ActorContextMenu';

interface ContextState {
  player: PublicPlayerState;
  x: number;
  y: number;
}

const mutableTrade = (trade: TradeSnapshot): boolean =>
  ['REQUESTED', 'OPEN', 'LOCKED'].includes(trade.status);
const mutableCombat = (combat: CombatSnapshot): boolean =>
  ['REQUESTED', 'ACTIVE'].includes(combat.status);
const dismissedCombat = (combat: CombatSnapshot): boolean =>
  ['DECLINED', 'EXPIRED', 'CANCELLED'].includes(combat.status);

export function PlayerInteractionLayer(): React.JSX.Element | null {
  const connection = useGameConnection();
  const state = useGameState();
  const { locale } = useI18n();
  const [context, setContext] = useState<ContextState>();
  const [trade, setTrade] = useState<TradeSnapshot>();
  const [combat, setCombat] = useState<CombatSnapshot>();
  const [busy, setBusy] = useState(false);

  useEffect(
    () =>
      connection.subscribeTrade((next) => {
        setContext(undefined);
        setTrade(next);
        gameStore.setActiveModal('trade');
      }),
    [connection],
  );

  useEffect(
    () =>
      connection.subscribeCombat((next) => {
        setContext(undefined);
        if (dismissedCombat(next)) {
          setCombat(undefined);
          gameStore.setActiveModal(null);
          return;
        }
        setCombat(next);
        gameStore.setActiveModal('combat');
      }),
    [connection],
  );

  useEffect(() => {
    if (state.phase !== 'in-world' || !state.socketConnected) return;
    let mounted = true;
    void Promise.all([connection.getActiveCombat(), connection.getActiveTrade()])
      .then(([activeCombat, activeTrade]) => {
        if (!mounted) return;
        if (activeCombat) {
          setCombat(activeCombat);
          gameStore.setActiveModal('combat');
        } else if (activeTrade) {
          setTrade(activeTrade);
          gameStore.setActiveModal('trade');
        }
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [connection, state.phase, state.socketConnected]);

  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<ContextState>).detail;
      if (detail && !gameStore.getSnapshot().activeModal) setContext(detail);
    };
    const dismiss = (event: PointerEvent) => {
      if (!(event.target as HTMLElement | null)?.closest('[data-actor-context-menu]'))
        setContext(undefined);
    };
    window.addEventListener(PLAYER_CONTEXT_EVENT, open);
    window.addEventListener('pointerdown', dismiss);
    return () => {
      window.removeEventListener(PLAYER_CONTEXT_EVENT, open);
      window.removeEventListener('pointerdown', dismiss);
    };
  }, []);

  const closeTrade = async (): Promise<void> => {
    const current = trade;
    setContext(undefined);
    if (current && mutableTrade(current) && !busy) {
      setBusy(true);
      try {
        await connection.cancelTrade(current.tradeId);
      } catch {
        // Global socket notification.
      } finally {
        setBusy(false);
      }
    }
    setTrade(undefined);
    gameStore.setActiveModal(null);
  };

  const closeCombat = async (): Promise<void> => {
    const current = combat;
    setContext(undefined);
    if (current && mutableCombat(current) && !busy) {
      setBusy(true);
      try {
        await connection.leaveCombat(current.combatId);
      } catch {
        // Global socket notification.
      } finally {
        setBusy(false);
      }
    }
    setCombat(undefined);
    gameStore.setActiveModal(null);
  };

  const startTrade = async (): Promise<void> => {
    if (!context || !state.self || busy) return;
    if (!canTradeWithPlayer(state.self, context.player)) {
      gameStore.addNotification({
        code: 'TRADE_TOO_FAR',
        message:
          locale === 'pl'
            ? 'Podejdź bliżej do gracza, aby handlować.'
            : 'Move closer to trade.',
      });
      setContext(undefined);
      return;
    }
    setBusy(true);
    try {
      const next = await connection.requestTrade(context.player.characterId);
      setTrade(next);
      setContext(undefined);
      gameStore.setActiveModal('trade');
    } catch {
      // Global socket notification.
    } finally {
      setBusy(false);
    }
  };

  const startCombat = async (): Promise<void> => {
    if (!context || !state.self || !state.map || busy) return;
    const availability = getPlayerCombatAvailability(
      state.self,
      context.player,
      state.map.zoneType,
    );
    if (availability === 'TOO_FAR' || availability === 'SELF') {
      gameStore.addNotification({
        code: 'COMBAT_TOO_FAR',
        message:
          locale === 'pl'
            ? 'Podejdź bliżej do gracza, aby zaatakować.'
            : 'Move closer to attack.',
      });
      setContext(undefined);
      return;
    }
    setBusy(true);
    try {
      const next = await connection.requestCombat(context.player.characterId);
      setCombat(next);
      setContext(undefined);
      gameStore.setActiveModal('combat');
    } catch {
      // SAFE and all other eligibility decisions are authoritative on the server.
    } finally {
      setBusy(false);
    }
  };

  const inviteToGroup = async (): Promise<void> => {
    if (!context || !state.self || busy) return;
    if (!canInteractWithPlayer(state.self, context.player)) {
      gameStore.addNotification({
        code: 'GROUP_TOO_FAR',
        message:
          locale === 'pl'
            ? 'Podejdź bliżej do gracza, aby dodać go do grupy.'
            : 'Move closer to invite this player to a group.',
      });
      setContext(undefined);
      return;
    }
    setBusy(true);
    try {
      await connection.inviteToGroup(context.player.characterId);
      gameStore.addNotification({
        code: 'GROUP_INVITE_SENT',
        message:
          locale === 'pl'
            ? `Zaproszenie do grupy wysłano do ${context.player.name}.`
            : `Group invitation sent to ${context.player.name}.`,
      });
      setContext(undefined);
    } catch {
      // Global socket notification.
    } finally {
      setBusy(false);
    }
  };

  const respondCombat = async (accept: boolean): Promise<void> => {
    if (!combat || busy) return;
    setBusy(true);
    try {
      const next = await connection.respondCombat(combat.combatId, accept);
      if (dismissedCombat(next)) {
        setCombat(undefined);
        gameStore.setActiveModal(null);
      } else {
        setCombat(next);
      }
    } catch {
      // Global socket notification.
    } finally {
      setBusy(false);
    }
  };

  if (combat && state.activeModal === 'combat') {
    if (combat.status === 'REQUESTED')
      return (
        <CombatRequestModal
          combat={combat}
          busy={busy}
          onRespond={(accept) => void respondCombat(accept)}
          onCancel={() => void closeCombat()}
        />
      );
    if (combat.status === 'ACTIVE' || combat.status === 'FINISHED')
      return (
        <CombatArena combat={combat} onChange={setCombat} onClose={() => void closeCombat()} />
      );
  }
  if (trade && state.activeModal === 'trade')
    return <TradeModal trade={trade} onChange={setTrade} onClose={() => void closeTrade()} />;
  if (!context) return null;

  return (
    <ActorContextMenu
      title={context.player.name}
      subtitle={`Lv. ${context.player.level}`}
      x={context.x}
      y={context.y}
      actions={[
        {
          key: 'trade',
          label: locale === 'pl' ? 'Handluj' : 'Trade',
          icon: '↔',
          run: startTrade,
          disabled: busy,
        },
        {
          key: 'attack',
          label: locale === 'pl' ? 'Atakuj' : 'Attack',
          icon: '⚔',
          run: startCombat,
          disabled: busy,
        },
        {
          key: 'group',
          label: locale === 'pl' ? 'Dodaj do grupy' : 'Add to group',
          icon: '✚',
          run: inviteToGroup,
          disabled: busy,
        },
      ]}
    />
  );
}
