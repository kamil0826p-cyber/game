import { MobileUnsupportedNotice } from '../components/common/MobileUnsupportedNotice';
import { GameCanvas } from '../game/canvas/GameCanvas';
import { GameHud } from '../ui/hud/GameHud';
import { PlayerTradeOverlay } from '../ui/trade/PlayerTradeOverlay';

export function GameScreen(): React.JSX.Element {
  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-slate-950">
      <GameCanvas />
      <GameHud />
      <PlayerTradeOverlay />
      <MobileUnsupportedNotice />
    </main>
  );
}
