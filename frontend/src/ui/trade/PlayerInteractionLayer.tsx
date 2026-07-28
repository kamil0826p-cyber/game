import { useEffect, useState } from 'react';
import type { PublicPlayerState } from '../../contracts/game';
import type { TradeSnapshot } from '../../contracts/socket';
import { PLAYER_CONTEXT_EVENT } from '../../game/engine/CharacterView';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { gameStore, useGameState } from '../../game/state/gameStore';
import { canTradeWithPlayer } from '../../game/trade/playerTrade';
import { useI18n } from '../../i18n/I18nProvider';
import { ActorContextMenu } from '../interactions/ActorContextMenu';
import { TradeModal } from './TradeModal';

interface ContextState { player: PublicPlayerState; x: number; y: number; }
const mutable = (trade: TradeSnapshot) => ['REQUESTED', 'OPEN', 'LOCKED'].includes(trade.status);

export function PlayerInteractionLayer(): React.JSX.Element | null {
  const connection = useGameConnection(); const state = useGameState(); const { locale } = useI18n();
  const [context, setContext] = useState<ContextState>(); const [trade, setTrade] = useState<TradeSnapshot>(); const [busy, setBusy] = useState(false);
  useEffect(() => connection.subscribeTrade((next) => { setContext(undefined); setTrade(next); gameStore.setActiveModal('trade'); }), [connection]);
  useEffect(() => { if (state.phase !== 'in-world' || !state.socketConnected) return; let mounted = true; void connection.getActiveTrade().then((active) => { if (mounted && active) { setTrade(active); gameStore.setActiveModal('trade'); } }).catch(() => undefined); return () => { mounted = false; }; }, [connection, state.phase, state.socketConnected]);
  useEffect(() => {
    const open = (event: Event) => { const detail = (event as CustomEvent<ContextState>).detail; if (detail && !gameStore.getSnapshot().activeModal) setContext(detail); };
    const dismiss = (event: PointerEvent) => { if (!(event.target as HTMLElement | null)?.closest('[data-actor-context-menu]')) setContext(undefined); };
    window.addEventListener(PLAYER_CONTEXT_EVENT, open); window.addEventListener('pointerdown', dismiss);
    return () => { window.removeEventListener(PLAYER_CONTEXT_EVENT, open); window.removeEventListener('pointerdown', dismiss); };
  }, []);
  const close = async () => { const current = trade; setContext(undefined); if (current && mutable(current) && !busy) { setBusy(true); try { await connection.cancelTrade(current.tradeId); } catch { /* global notification */ } finally { setBusy(false); } } setTrade(undefined); gameStore.setActiveModal(null); };
  const start = async () => { if (!context || !state.self || busy) return; if (!canTradeWithPlayer(state.self, context.player)) { gameStore.addNotification({ code: 'TRADE_TOO_FAR', message: locale === 'pl' ? 'Podejdź bliżej do gracza, aby handlować.' : 'Move closer to trade.' }); setContext(undefined); return; } setBusy(true); try { const next = await connection.requestTrade(context.player.characterId); setTrade(next); setContext(undefined); gameStore.setActiveModal('trade'); } catch { /* global notification */ } finally { setBusy(false); } };
  if (trade && state.activeModal === 'trade') return <TradeModal trade={trade} onChange={setTrade} onClose={() => void close()} />;
  if (!context) return null;
  const actions = [{ key: 'trade', label: locale === 'pl' ? 'Handluj' : 'Trade', icon: '↔', run: start }];
  return <ActorContextMenu title={context.player.name} subtitle={`Lv. ${context.player.level}`} x={context.x} y={context.y} actions={actions.map((action) => ({ ...action, disabled: busy }))} />;
}
