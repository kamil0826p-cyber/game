import { useEffect, useMemo, useState } from 'react';
import type { PublicPlayerState } from '../../contracts/game';
import type { InventorySnapshot, TradeSnapshot } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { gameStore } from '../../game/state/gameStore';

export const PLAYER_CONTEXT_EVENT = 'game:player-context';
export interface PlayerContextDetail { player: PublicPlayerState; clientX: number; clientY: number; }

type Selection = Record<string, number>;

export function PlayerTradeOverlay(): React.JSX.Element | null {
  const client = useGameConnection();
  const [context, setContext] = useState<PlayerContextDetail | null>(null);
  const [trade, setTrade] = useState<TradeSnapshot | null>(null);
  const [inventory, setInventory] = useState<InventorySnapshot | null>(null);
  const [selection, setSelection] = useState<Selection>({});
  const [silver, setSilver] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onContext = (event: Event) => setContext((event as CustomEvent<PlayerContextDetail>).detail);
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
      void client.getInventory().then((snapshot) => { setInventory(snapshot); gameStore.addNotification({ code: 'TRADE_COMPLETED', message: 'Handel zakończony.' }); }).catch(() => undefined);
    }
  }), [client]);

  const selfSide = useMemo(() => trade ? (trade.initiator.characterId === trade.selfCharacterId ? trade.initiator : trade.recipient) : null, [trade]);
  const otherSide = useMemo(() => trade ? (trade.initiator.characterId === trade.selfCharacterId ? trade.recipient : trade.initiator) : null, [trade]);
  const isIncoming = trade?.status === 'REQUESTED' && trade.recipient.characterId === trade.selfCharacterId;
  const terminal = trade && ['COMPLETED', 'CANCELLED', 'EXPIRED'].includes(trade.status);

  const run = async (operation: () => Promise<TradeSnapshot>): Promise<void> => {
    setBusy(true);
    try { setTrade(await operation()); } finally { setBusy(false); }
  };

  const sendOffer = (): void => {
    if (!trade) return;
    const items = Object.entries(selection).filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
    void run(() => client.updateTradeOffer(trade.id, items, silver));
  };

  if (context) {
    return (
      <div className="fixed inset-0 z-[80]" onMouseDown={() => setContext(null)}>
        <div className="fantasy-panel absolute min-w-44 p-2" style={{ left: Math.min(context.clientX, window.innerWidth - 190), top: Math.min(context.clientY, window.innerHeight - 90) }} onMouseDown={(event) => event.stopPropagation()}>
          <div className="px-3 py-2 text-xs font-semibold text-slate-300">{context.player.name}</div>
          <button type="button" className="retro-button w-full px-3 py-2 text-left text-sm" onClick={() => void run(() => client.requestTrade(context.player.characterId))}>Handluj</button>
        </div>
      </div>
    );
  }

  if (!trade) return null;

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-slate-950/70 p-4">
      <section className="fantasy-panel w-full max-w-4xl p-5 text-slate-100">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="font-display text-2xl text-amber-100">Handel gracz–gracz</h2><p className="text-xs text-slate-400">Zmiana oferty cofa akceptację obu graczy.</p></div>
          <button type="button" className="retro-button px-3 py-2" disabled={busy} onClick={() => trade.status === 'REQUESTED' && !isIncoming ? void run(() => client.cancelTrade(trade.id)) : void run(() => client.cancelTrade(trade.id))}>Anuluj</button>
        </div>

        {trade.status === 'REQUESTED' ? (
          <div className="mt-6 rounded border border-slate-700 bg-slate-900/70 p-5 text-center">
            <p>{isIncoming ? `${trade.initiator.name} chce z Tobą handlować.` : `Oczekiwanie na odpowiedź gracza ${trade.recipient.name}.`}</p>
            {isIncoming && <div className="mt-4 flex justify-center gap-3"><button type="button" className="retro-button px-5 py-2 text-emerald-200" disabled={busy} onClick={() => void run(() => client.respondTrade(trade.id, true))}>Akceptuj</button><button type="button" className="retro-button px-5 py-2 text-rose-200" disabled={busy} onClick={() => void run(() => client.respondTrade(trade.id, false))}>Odrzuć</button></div>}
          </div>
        ) : terminal ? (
          <div className="mt-6 text-center"><p className="text-lg">{trade.status === 'COMPLETED' ? 'Handel zakończony pomyślnie.' : trade.status === 'EXPIRED' ? 'Handel wygasł.' : 'Handel anulowany.'}</p><button type="button" className="retro-button mt-4 px-5 py-2" onClick={() => setTrade(null)}>Zamknij</button></div>
        ) : (
          <>
            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <TradeSide title={`${selfSide?.name ?? 'Ty'} — Twoja oferta`} accepted={selfSide?.accepted ?? false} silver={selfSide?.offeredSilver ?? 0} items={selfSide?.items ?? []} />
              <TradeSide title={`${otherSide?.name ?? 'Gracz'} — oferta`} accepted={otherSide?.accepted ?? false} silver={otherSide?.offeredSilver ?? 0} items={otherSide?.items ?? []} />
            </div>
            <div className="mt-5 rounded border border-slate-700 bg-slate-900/70 p-4">
              <h3 className="font-semibold text-amber-100">Wybierz przedmioty</h3>
              <div className="mt-3 grid max-h-48 gap-2 overflow-y-auto sm:grid-cols-2">
                {(inventory?.items ?? []).filter((item) => !item.equippedSlot).map((item) => (
                  <label key={item.id} className="flex items-center gap-2 rounded border border-slate-700 px-3 py-2 text-sm">
                    <input type="checkbox" checked={(selection[item.id] ?? 0) > 0} onChange={(event) => setSelection((current) => ({ ...current, [item.id]: event.target.checked ? 1 : 0 }))} />
                    <span className="flex-1">{item.icon} {item.name} ×{item.quantity}</span>
                    {(selection[item.id] ?? 0) > 0 && <input aria-label={`Ilość ${item.name}`} className="w-16 rounded bg-slate-950 px-2 py-1" type="number" min={1} max={item.quantity} value={selection[item.id]} onChange={(event) => setSelection((current) => ({ ...current, [item.id]: Math.max(1, Math.min(item.quantity, Number(event.target.value) || 1)) }))} />}
                  </label>
                ))}
              </div>
              <label className="mt-4 flex items-center gap-3 text-sm"><span>Srebro</span><input className="w-36 rounded bg-slate-950 px-3 py-2" type="number" min={0} max={inventory?.silver ?? 0} value={silver} onChange={(event) => setSilver(Math.max(0, Math.min(inventory?.silver ?? 0, Math.trunc(Number(event.target.value) || 0))))} /><span className="text-slate-400">/ {inventory?.silver ?? 0}</span></label>
              <div className="mt-4 flex flex-wrap gap-3"><button type="button" className="retro-button px-5 py-2" disabled={busy} onClick={sendOffer}>Zapisz ofertę</button><button type="button" className="retro-button px-5 py-2 text-emerald-200" disabled={busy || selfSide?.accepted} onClick={() => void run(() => client.acceptTrade(trade.id))}>{selfSide?.accepted ? 'Zaakceptowano' : 'Akceptuję handel'}</button></div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}

function TradeSide({ title, accepted, silver, items }: { title: string; accepted: boolean; silver: number; items: TradeSnapshot['initiator']['items'] }): React.JSX.Element {
  return <div className="rounded border border-slate-700 bg-slate-900/70 p-4"><div className="flex justify-between"><h3 className="font-semibold">{title}</h3><span className={accepted ? 'text-emerald-300' : 'text-slate-500'}>{accepted ? '✓ zaakceptowano' : 'oczekuje'}</span></div><p className="mt-2 text-sm text-amber-200">Srebro: {silver}</p><div className="mt-3 min-h-24 space-y-2">{items.length === 0 ? <p className="text-sm text-slate-500">Brak przedmiotów</p> : items.map((item) => <div key={item.id} className="rounded border border-slate-700 px-3 py-2 text-sm">{item.icon} {item.name} ×{item.quantity}</div>)}</div></div>;
}
