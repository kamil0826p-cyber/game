import { useState } from 'react';
import type { TradeSnapshot } from '../../contracts/socket';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { Modal } from './Modal';

export function TradeRequestModal({ trade }: { trade: TradeSnapshot }): React.JSX.Element {
  const connection = useGameConnection();
  const [busy, setBusy] = useState(false);
  const respond = async (accept: boolean) => {
    if (busy) return;
    setBusy(true);
    try { await connection.respondToTrade(trade.id, accept); } catch { setBusy(false); }
  };
  return (
    <Modal title="Prośba o handel" subtitle={`${trade.initiator.name} chce rozpocząć handel.`} icon="↔" onClose={() => void respond(false)} widthClass="max-w-md">
      <p className="text-sm leading-6 text-slate-300">Zaakceptuj tylko wtedy, gdy gracz stoi obok Ciebie. Oferta może zawierać przedmioty i srebro. Gold nie jest obsługiwany.</p>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="hud-utility-button" disabled={busy} onClick={() => void respond(false)}>Odrzuć</button>
        <button type="button" className="retro-button border-emerald-300/70 bg-emerald-500/20 text-emerald-100" disabled={busy} onClick={() => void respond(true)}>Akceptuj</button>
      </div>
    </Modal>
  );
}
