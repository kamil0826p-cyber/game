import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PublicPlayerState } from '../../contracts/game';
import type { InventorySnapshot, TradeSnapshot } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { gameStore } from '../../game/state/gameStore';

export const PLAYER_CONTEXT_EVENT = 'game:player-context';
export interface PlayerContextDetail { player: PublicPlayerState; clientX: number; clientY: number; }

type Selection = Record<string, number>;
type PanelPosition = { left: number; top: number };

const PANEL_WIDTH = 340;
const PANEL_HEIGHT = 440;

function clampPosition(clientX: number, clientY: number): PanelPosition {
  return {
    left: Math.max(8, Math.min(clientX, window.innerWidth - PANEL_WIDTH - 8)),
    top: Math.max(8, Math.min(clientY, window.innerHeight - PANEL_HEIGHT - 8)),
  };
}

export function PlayerTradeOverlay(): React.JSX.Element | null {
  const client = useGameConnection();
  const [context, setContext] = useState<PlayerContextDetail | null>(null);
  const [position, setPosition] = useState<PanelPosition>({ left: 16, top: 80 });
  const [trade, setTrade] = useState<TradeSnapshot | null>(null);
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [silver, setSilver] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onContext = (event: Event) => {
      const detail = (event as CustomEvent<PlayerContextDetail>).detail;
      setPosition(clampPosition(detail.clientX, detail.clientY));
      setContext(detail);
    };
    window.addEventListener(PLAYER_CONTEXT_EVENT, onContext);
    return () => window.removeEventListener(PLAYER_CONTEXT_EVENT, onContext);
  }, []);

  useEffect(() => client.subscribeTrade((next) => {
    setTrade(next);
    setContext(null);
    if (next.status === 'OPEN' || next.status === 'LOCKED') {
      void client.getInventory().then(setInventory).catch(() => undefined);
    }
    if (next.status === 'COMPLETED') {
      void client.getInventory().then((snapshot) => {
        setInventory(snapshot);
        gameStore.addNotification({ code: 'TRADE_COMPLETED', message: 'Handel zakończony.' });
      }).catch(() => undefined);
    }
  }), [client]);

  const selfSide = useMemo(() => trade ? (trade.initiator.characterId === trade.selfCharacterId ? trade.initiator : trade.recipient) : null, [trade]);
  const otherSide = useMemo(() => trade ? (trade.initiator.characterId === trade.selfCharacterId ? trade.recipient : trade.initiator) : null, [trade]);
  const isIncoming = trade?.status === 'REQUESTED' && trade.recipient.characterId === trade.selfCharacterId;
  const terminal = trade && ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(trade.status);
  const availableItems = (inventory?.items ?? []).filter((item) => !item.equippedSlot);

  const run = async (operation: () => Promise<TradeSnapshot>): Promise<void> => {
    setBusy(true);
    try { setTrade(await operation()); } finally { setBusy(false); }
  };

  const sendOffer = (): void => {
    if (!trade) return;
    const items = Object.entries(selection).filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
    void run(() => client.updateTradeOffer(trade.id, items, silver));
  };

  if (typeof document === 'undefined') return null;

  if (context) {
    return createPortal(
      <>
        <button aria-label="Zamknij menu gracza" type="button" className="fixed inset-0 z-[79] cursor-default bg-transparent" onClick={() => setContext(null)} />
        <div className="fantasy-panel fixed z-[80] w-48 p-2 text-slate-100 shadow-2xl" style={position}>
          <div className="truncate border-b border-slate-700 px-2 py-1.5 text-xs font-semibold text-slate-300">{context.player.name}</div>
          <button type="button" className="retro-button mt-2 w-full px-3 py-2 text-left text-sm" disabled={busy} onClick={() => void run(() => client.requestTrade(context.player.characterId))}>Handluj</button>
        </div>
      </>,
      document.body,
    );
  }

  if (!trade) return null;

  return createPortal(
    <aside className="fantasy-panel fixed z-[80] flex max-h-[440px] w-[340px] max-w-[calc(100vw-16px)] flex-col overflow-hidden text-slate-100 shadow-2xl" style={position}>
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-700 px-3 py-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-amber-100">Handel: {otherSide?.name ?? 'gracz'}</h2>
          <p className="text-[10px] text-slate-500">Zmiana oferty cofa akceptację.</p>
        </div>
        <button type="button" className="retro-button shrink-0 px-2 py-1 text-xs" disabled={busy} onClick={() => void run(() => client.cancelTrade(trade.id))}>Anuluj</button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {trade.status === 'REQUESTED' ? (
          <div className="space-y-3 text-center">
            <p>{isIncoming ? `${trade.initiator.name} proponuje handel.` : `Czekasz na ${trade.recipient.name}.`}</p>
            {isIncoming && <div className="flex justify-center gap-2"><button type="button" className="retro-button px-3 py-1.5 text-emerald-200" disabled={busy} onClick={() => void run(() => client.respondTrade(trade.id, true))}>Akceptuj</button><button type="button" className="retro-button px-3 py-1.5 text-rose-200" disabled={busy} onClick={() => void run(() => client.respondTrade(trade.id, false))}>Odrzuć</button></div>}
          </div>
        ) : terminal ? (
          <div className="py-3 text-center"><p>{trade.status === 'COMPLETED' ? 'Handel zakończony.' : trade.status === 'EXPIRED' ? 'Handel wygasł.' : 'Handel anulowany.'}</p><button type="button" className="retro-button mt-3 px-3 py-1.5" onClick={() => setTrade(null)}>Zamknij</button></div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <TradeSide title="Ty" accepted={selfSide?.accepted ?? false} silver={selfSide?.offeredSilver ?? 0} items={selfSide?.items ?? []} />
              <TradeSide title={otherSide?.name ?? 'Gracz'} accepted={otherSide?.accepted ?? false} silver={otherSide?.offeredSilver ?? 0} items={otherSide?.items ?? []} />
            </div>

            <div className="border-t border-slate-700 pt-2">
              <div className="mb-1 text-[11px] font-semibold text-amber-100">Przedmioty</div>
              <div className="max-h-32 space-y-1 overflow-y-auto pr-1">
                {availableItems.map((item) => (
                  <label key={item.id} className="flex min-w-0 items-center gap-1.5 rounded border border-slate-700 px-2 py-1.5">
                    <input type="checkbox" checked={(selection[item.id] ?? 0) > 0} onChange={(event) => setSelection((current) => ({ ...current, [item.id]: event.target.checked ? 1 : 0 }))} />
                    <span className="min-w-0 flex-1 truncate">{item.icon} {item.name} ×{item.quantity}</span>
                    {(selection[item.id] ?? 0) > 0 && <input aria-label={`Ilość ${item.name}`} className="w-11 rounded bg-slate-950 px-1 py-0.5" type="number" min={1} max={item.quantity} value={selection[item.id]} onChange={(event) => setSelection((current) => ({ ...current, [item.id]: Math.max(1, Math.min(item.quantity, Number(event.target.value) || 1)) }))} />}
                  </label>
                ))}
                {availableItems.length === 0 && <p className="text-slate-500">Brak dostępnych przedmiotów.</p>}
              </div>
            </div>

            <label className="flex items-center gap-2 border-t border-slate-700 pt-2"><span>Srebro</span><input className="w-20 rounded bg-slate-950 px-2 py-1" type="number" min={0} max={inventory?.silver ?? 0} value={silver} onChange={(event) => setSilver(Math.max(0, Math.min(inventory?.silver ?? 0, Math.trunc(Number(event.target.value) || 0))))} /><span className="text-slate-500">/{inventory?.silver ?? 0}</span></label>

            <div className="flex gap-2"><button type="button" className="retro-button flex-1 px-2 py-1.5" disabled={busy} onClick={sendOffer}>Zapisz</button><button type="button" className="retro-button flex-1 px-2 py-1.5 text-emerald-200" disabled={busy || selfSide?.accepted} onClick={() => void run(() => client.acceptTrade(trade.id))}>{selfSide?.accepted ? 'Gotowe' : 'Akceptuj'}</button></div>
          </div>
        )}
      </div>
    </aside>,
    document.body,
  );
}

function TradeSide({ title, accepted, silver, items }: { title: string; accepted: boolean; silver: number; items: TradeSnapshot['initiator']['items'] }): React.JSX.Element {
  return <div className="min-w-0 rounded border border-slate-700 bg-slate-900/70 p-2"><div className="flex items-center justify-between gap-1"><span className="truncate font-semibold">{title}</span><span className={accepted ? 'text-emerald-300' : 'text-slate-600'}>{accepted ? '✓' : '…'}</span></div><div className="mt-1 text-amber-200">Srebro: {silver}</div><div className="mt-1 max-h-16 space-y-1 overflow-y-auto">{items.length === 0 ? <span className="text-slate-600">Brak</span> : items.map((item) => <div key={item.id} className="truncate">{item.icon} {item.name} ×{item.quantity}</div>)}</div></div>;
}
