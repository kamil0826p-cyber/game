import { useEffect, useRef } from 'react';
import { gameStore } from '../state/gameStore';
import { GameEngine } from '../engine/GameEngine';
import { useGameConnection } from '../realtime/GameConnectionProvider';

export function GameCanvas(): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const client = useGameConnection();

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const engine = new GameEngine(host, client);
    void engine.start().catch((error: unknown) => {
      gameStore.setFatalError(
        error instanceof Error ? error.message : 'The game renderer could not start.',
      );
    });
    return () => engine.destroy();
  }, [client]);

  return <div ref={hostRef} className="absolute inset-0 overflow-hidden" aria-label="Game world" />;
}
