import { useEffect, useState } from 'react';
import type { PublicPlayerState } from '../../contracts/game';
import type { TradeSnapshot } from '../../contracts/socket';
import { PLAYER_CONTEXT_EVENT } from '../../game/engine/CharacterView';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { gameStore, useGameState } from '../../game/state/gameStore';
import { canTradeWithPlayer } from '../../game/trade/playerTrade';
import { useI18n } from '../../i18n/I18nProvider';
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
    const dismiss = (event: PointerEvent) => { if (!(event.target as HTMLElement | null)?.closest('[data-player-context-menu]')) setContext(undefined); };
    window.addEventListener(PLAYER_CONTEXT_EVENT, open); window.addEventListener('pointerdown', dismiss);
    return () => { window.removeEventListener(PLAYER_CONTEXT_EVENT, open); window.removeEventListener('pointerdown', dismiss); };
  }, []);
  const close = async () => { const current = trade; setContext(undefined); if (current && mutable(current) && !busy) { setBusy(true); try { await connection.cancelTrade(current.tradeId); } catch { /* global notification */ } finally { setBusy(false); } } setTrade(undefined); gameStore.setActiveModal(null); };
  const start = async () => { if (!context || !state.self || busy) return; if (!canTradeWithPlayer(state.self, context.player)) { gameStore.addNotification({ code: 'TRADE_TOO_FAR', message: locale === 'pl' ? 'Podejdź bliżej do gracza, aby handlować.' : 'Move closer to trade.' }); setContext(undefined); return; } setBusy(true); try { const next = await connection.requestTrade(context.player.characterId); setTrade(next); setContext(undefined); gameStore.setActiveModal('trade'); } catch { /* global notification */ } finally { setBusy(false); } };
  if (trade && state.activeModal === 'trade') return <TradeModal trade={trade} onChange={setTrade} onClose={() => void close()} />;
  if (!context) return null;
  const left = Math.min(Math.max(12, context.x + 10), window.innerWidth - 180); const top = Math.min(Math.max(12, context.y - 12), window.innerHeight - 120);
  const actions = [{ key: 'trade', label: locale === 'pl' ? 'Handluj' : 'Trade', icon: '↔', run: start }];
  return <div data-player-context-menu className="pointer-events-auto fixed z-40 w-44 overflow-hidden rounded-lg border border-amber-300/25 bg-slate-950/95 p-1 shadow-2xl" style={{ left, top }}><div className="border-b border-white/10 px-3 py-2"><strong className="block truncate text-sm text-amber-100">{context.player.name}</strong><span className="text-[11px] text-slate-400">Lv. {context.player.level}</span></div>{actions.map((action) => <button key={action.key} type="button" disabled={busy} className="flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm hover:bg-amber-400/10 disabled:opacity-50" onClick={() => void action.run()}><span className="text-amber-200">{action.icon}</span>{action.label}</button>)}</div>;
}
