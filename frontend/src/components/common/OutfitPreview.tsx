import { useEffect, useRef } from 'react';
import type { CharacterClass, Direction } from '../../contracts/game';
import { outfitImageCandidates } from '../../mock/outfitCatalog';

const directionRows: Record<Direction, number> = { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 };

interface OutfitPreviewProps {
  outfitKey: string;
  characterClass: CharacterClass;
  direction?: Direction;
  size?: 'small' | 'large';
  animated?: boolean;
  renderScale?: number;
  className?: string;
}

export function OutfitPreview({
  outfitKey,
  characterClass: _characterClass,
  direction = 'SOUTH',
  size = 'large',
  animated = true,
  renderScale = 1,
  className = '',
}: OutfitPreviewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    context.imageSmoothingEnabled = false;
    const image = new Image();
    image.decoding = 'async';
    const mob = outfitKey.startsWith('mob-');
    const safeRenderScale = Math.max(0.2, Math.min(3, renderScale));
    const candidates = mob
      ? [`${import.meta.env.BASE_URL}assets/mobs/${encodeURIComponent(outfitKey)}.svg`]
      : [...outfitImageCandidates(outfitKey)];
    let candidateIndex = 0;
    let frameId = 0;
    let start = performance.now();
    let loaded = false;
    let cancelled = false;

    const tryNextCandidate = () => {
      loaded = false;
      const next = candidates[candidateIndex++];
      if (next) {
        image.src = next;
        return;
      }
      console.error(`No outfit image candidate could be loaded for ${outfitKey}.`);
    };

    const draw = (now: number) => {
      if (cancelled) return;
      context.clearRect(0, 0, canvas.width, canvas.height);

      if (loaded && image.naturalWidth > 0) {
        if (mob) {
          const scale = Math.min(88 / image.naturalWidth, 112 / image.naturalHeight) * safeRenderScale;
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          context.drawImage(image, (96 - width) / 2, 144 - height - 12, width, height);
        } else {
          const frame = animated ? Math.floor((now - start) / 120) % 4 : 0;
          context.drawImage(
            image,
            frame * 32,
            directionRows[direction] * 48,
            32,
            48,
            0,
            0,
            96,
            144,
          );
        }
      }

      frameId = requestAnimationFrame(draw);
    };

    image.onload = () => {
      if (cancelled) return;
      const validSheet = mob || (image.naturalWidth === 128 && image.naturalHeight === 192);
      if (!validSheet) {
        console.error(`Outfit ${outfitKey} has invalid dimensions ${image.naturalWidth}x${image.naturalHeight}. Expected 128x192.`);
        tryNextCandidate();
        return;
      }
      loaded = true;
      start = performance.now();
    };
    image.onerror = () => {
      if (cancelled) return;
      console.warn(`Outfit image failed to load: ${image.src}`);
      tryNextCandidate();
    };

    tryNextCandidate();
    frameId = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      image.onload = null;
      image.onerror = null;
    };
  }, [animated, direction, outfitKey, renderScale]);

  return (
    <canvas
      ref={canvasRef}
      width={96}
      height={144}
      className={`pixelated ${size === 'small' ? 'h-20 w-14' : 'h-36 w-24'} ${className}`}
      aria-label={`${outfitKey} animated outfit preview`}
    />
  );
}
