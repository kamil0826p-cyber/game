import { MobileUnsupportedNotice } from '../components/common/MobileUnsupportedNotice';
import { BackgroundMusic } from '../game/audio/BackgroundMusic';
import { GameCanvas } from '../game/canvas/GameCanvas';
import { GameHud } from '../ui/hud/GameHud';

export function GameScreen(): React.JSX.Element {
  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-slate-950">
      <GameCanvas />
      <BackgroundMusic />
      <GameHud />
      <MobileUnsupportedNotice />
    </main>
  );
}
