import { useState } from 'react';
import type { PublicPlayerState } from '../../contracts/game';
import { useGameConnection } from '../../game/realtime/GameConnectionProvider';
import { Modal } from './Modal';

export function PlayerInteractionModal({ player, onClose }: { player: PublicPlayerState; onClose: () => void }): React.JSX.Element {
  const connection = useGameConnection();
  const [busy, setBusy] = useState(false);
  const trade = async () => {
    if (busy) return;
    setBusy(true);
    try { await connection.requestTrade(player.characterId); } catch { setBusy(false); }
  };
  return (
    <Modal title={player.name} subtitle={`Poziom ${player.level}`} icon="◆" onClose={onClose} widthClass="max-w-sm">
      <div className="grid gap-2">
        <button type="button" className="retro-button border-amber-300/70 bg-amber-500/20 text-amber-100" disabled={busy} onClick={() => void trade()}>
          {busy ? 'Wysyłanie prośby…' : 'Handluj'}
        </button>
        <button type="button" className="hud-utility-button opacity-50" disabled title="Atak zostanie dodany w kolejnym systemie.">Atak</button>
      </div>
    </Modal>
  );
}
