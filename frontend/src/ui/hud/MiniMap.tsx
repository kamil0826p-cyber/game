import { useEffect, useRef, useState } from 'react';
import type { MapStatePayload, PublicPlayerState, SelfCharacterState } from '../../contracts/game';
import type { LoadedMapDefinition } from '../../contracts/tiled';
import { mapRepository } from '../../game/map/MapRepository';

interface MiniMapProps {
  map: MapStatePayload;
  character: SelfCharacterState;
  players: Readonly<Record<string, PublicPlayerState>>;
}

export function MiniMap({ map, character, players }: MiniMapProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [definition, setDefinition] = useState<LoadedMapDefinition | undefined>(
    undefined,
  );

  useEffect(() => {
    let active = true;
    void mapRepository.load(map.key).then((loaded) => {
      if (active) setDefinition(loaded);
    });
    return () => { active = false; };
  }, [map.key, map.version]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !definition) return;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.imageSmoothingEnabled = false;
    const width = canvas.width;
    const height = canvas.height;
    const scale = Math.min(width / definition.width, height / definition.height);
    const offsetX = (width - definition.width * scale) / 2;
    const offsetY = (height - definition.height * scale) / 2;
    context.clearRect(0, 0, width, height);
    context.fillStyle = map.key === 'crystal-cave' ? '#211d31' : '#1f3c29';
    context.fillRect(offsetX, offsetY, definition.width * scale, definition.height * scale);
    context.fillStyle = map.key === 'crystal-cave' ? '#5b6389' : '#65745a';
    for (let y = 0; y < definition.height; y += 1) {
      for (let x = 0; x < definition.width; x += 1) {
        if (definition.collision[y * definition.width + x] === 1) {
          context.fillRect(offsetX + x * scale, offsetY + y * scale, Math.ceil(scale), Math.ceil(scale));
        }
      }
    }
    context.fillStyle = '#c084fc';
    for (const portal of definition.portals) {
      context.fillRect(offsetX + portal.sourceX * scale, offsetY + portal.sourceY * scale, Math.max(2, scale), Math.max(2, scale));
    }
    context.fillStyle = '#f8fafc';
    for (const player of Object.values(players)) {
      context.beginPath();
      context.arc(offsetX + (player.x + 0.5) * scale, offsetY + (player.y + 0.5) * scale, 1.8, 0, Math.PI * 2);
      context.fill();
    }
    context.fillStyle = '#facc15';
    context.beginPath();
    context.arc(offsetX + (character.x + 0.5) * scale, offsetY + (character.y + 0.5) * scale, 3, 0, Math.PI * 2);
    context.fill();
  }, [character.x, character.y, definition, map.key, players]);

  return (
    <section className="hud-panel pointer-events-auto w-[210px] p-2" aria-label="Mini-map">
      <div className="mb-1.5 flex items-center justify-between px-1">
        <span className="truncate font-display text-sm text-amber-100">{map.name}</span>
        <span className={`zone-badge zone-${map.zoneType.toLowerCase()}`}>{map.zoneType}</span>
      </div>
      <canvas ref={canvasRef} width={384} height={240} className="pixelated aspect-[8/5] w-full rounded border border-black/60 bg-slate-950/80" />
      <div className="mt-1.5 flex justify-between px-1 text-[9px] uppercase tracking-wider text-slate-500">
        <span>Players {Object.keys(players).length + 1}</span><span>{character.x}, {character.y}</span>
      </div>
    </section>
  );
}
