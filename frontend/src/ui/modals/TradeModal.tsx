import { useEffect, useMemo, useState } from 'react';
import type { InventorySnapshot, TradeSnapshot } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { Modal } from './Modal';

export function TradeModal({ trade }: { trade: TradeSnapshot }): React.JSX.Element {
  const connection = useGameConnection();
  const [inventory, setInventory] = useState<InventorySnapshot>();
  const [selected, setSelected] = useState<Record<string, number>>({});
  const [silver, setSilver] = useState(0);
  const [busy, setBusy] = useState(false);
  const self = trade.selfCharacterId === trade.initiator.characterId ? trade.initiator : trade.recipient;
  const other = trade.selfCharacterId === trade.initiator.characterId ? trade.recipient : trade.initiator;
  const ownItems = trade.items.filter((item) => item.offeredByCharacterId === self.characterId);
  const otherItems = trade.items.filter((item) => item.offeredByCharacterId === other.characterId);
  const offeredIds = useMemo(() => new Set(ownItems.map((item) => item.itemId)), [ownItems]);

  useEffect(() => {
    let mounted = true;
    void connection.getInventory().then((snapshot) => {
      if (!mounted) return;
      setInventory(snapshot);
      setSilver(self.silver);
      setSelected(Object.fromEntries(ownItems.map((item) => [item.itemId, item.quantity])));
    }).catch(() => undefined);
    return () => { mounted = false; };
  }, [connection, trade.id]);

  const saveOffer = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await connection.updateTradeOffer(trade.id, silver, Object.entries(selected).filter(([, quantity]) => quantity > 0).map(([itemId, quantity]) => ({ itemId, quantity })));
    } finally { setBusy(false); }
  };
  const confirm = async () => { if (!busy) { setBusy(true); try { await connection.confirmTrade(trade.id); } finally { setBusy(false); } } };
  const cancel = async () => { if (!busy) { setBusy(true); try { await connection.cancelTrade(trade.id); } finally { setBusy(false); } } };

  return (
    <Modal title={`Handel z ${other.name}`} subtitle="Każda zmiana oferty cofa wcześniejsze potwierdzenia." icon="↔" onClose={() => void cancel()} widthClass="max-w-5xl">
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <div className="flex items-center justify-between"><h3 className="modal-section-title">Twoja oferta</h3><span className={self.accepted ? 'text-emerald-300' : 'text-amber-200'}>{self.accepted ? 'Potwierdzona' : 'Niepotwierdzona'}</span></div>
          <label className="mt-4 block text-xs uppercase tracking-wide text-slate-400">Srebro</label>
          <input type="number" min={0} max={inventory?.silver ?? 0} value={silver} disabled={busy || self.accepted} onChange={(event) => setSilver(Math.max(0, Math.min(inventory?.silver ?? 0, Math.trunc(Number(event.target.value) || 0))))} className="mt-1 w-full rounded-lg border border-white/10 bg-slate-900 px-3 py-2" />
          <p className="mt-1 text-xs text-slate-500">Dostępne: {inventory?.silver ?? 0} srebra. Gold nie może być przekazywany.</p>
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6">
            {inventory?.items.map((item) => {
              const quantity = selected[item.id] ?? 0;
              return <button key={item.id} type="button" disabled={busy || Boolean(item.equippedSlot) || self.accepted} onClick={() => setSelected((current) => ({ ...current, [item.id]: quantity > 0 ? 0 : item.quantity }))} className={`inventory-slot ${quantity > 0 || offeredIds.has(item.id) ? 'ring-2 ring-amber-300' : ''}`} title={item.equippedSlot ? 'Najpierw zdejmij przedmiot.' : item.name}><span className="text-xl">{item.icon}</span><small>{quantity > 0 ? `${quantity}/${item.quantity}` : item.quantity}</small></button>;
            })}
          </div>
          <button type="button" className="hud-utility-button mt-4 w-full" disabled={busy || self.accepted} onClick={() => void saveOffer()}>Zapisz ofertę</button>
        </section>
        <section className="rounded-xl border border-white/10 bg-slate-950/60 p-4">
          <div className="flex items-center justify-between"><h3 className="modal-section-title">Oferta: {other.name}</h3><span className={other.accepted ? 'text-emerald-300' : 'text-amber-200'}>{other.accepted ? 'Potwierdzona' : 'Niepotwierdzona'}</span></div>
          <div className="mt-4 rounded-lg border border-white/10 bg-slate-900/70 p-3"><span className="text-xs uppercase tracking-wide text-slate-400">Srebro</span><strong className="mt-1 block text-xl text-amber-200">{other.silver}</strong></div>
          <div className="mt-4 space-y-2">
            {otherItems.length === 0 ? <p className="text-sm text-slate-500">Brak przedmiotów w ofercie.</p> : otherItems.map((item) => <div key={item.itemId} className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/70 px-3 py-2"><span>{item.name}</span><strong>×{item.quantity}</strong></div>)}
          </div>
        </section>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2 border-t border-white/10 pt-4">
        <button type="button" className="hud-utility-button" disabled={busy} onClick={() => void cancel()}>Anuluj handel</button>
        <button type="button" className="retro-button border-emerald-300/70 bg-emerald-500/20 text-emerald-100" disabled={busy || self.accepted || trade.status !== 'OPEN'} onClick={() => void confirm()}>Potwierdź ofertę</button>
      </div>
    </Modal>
  );
}
