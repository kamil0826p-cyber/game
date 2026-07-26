import { useEffect, useRef } from 'react';
import type { CharacterClass, Direction } from '../../contracts/game';
import { outfitImageUrl } from '../../mock/outfitCatalog';

const directionRows: Record<Direction, number> = {
  SOUTH: 0,
  WEST: 1,
  EAST: 2,
  NORTH: 3,
};

const classColors: Record<CharacterClass, string> = {
  MAGE: '#6d5bd0',
  WARRIOR: '#b45454',
  ARCHER: '#4f9467',
};

interface OutfitPreviewProps {
  outfitKey: string;
  characterClass: CharacterClass;
  direction?: Direction;
  size?: 'small' | 'large';
  animated?: boolean;
  className?: string;
}

export function OutfitPreview({
  outfitKey,
  characterClass,
  direction = 'SOUTH',
  size = 'large',
  animated = true,
  className = '',
}: OutfitPreviewProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }
    context.imageSmoothingEnabled = false;
    const image = new Image();
    let frameId = 0;
    let start = performance.now();
    let cancelled = false;

    const drawFallback = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = 'rgba(3, 5, 12, 0.45)';
      context.beginPath();
      context.ellipse(48, 131, 26, 8, 0, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = '#e8b98f';
      context.fillRect(39, 25, 18, 24);
      context.fillStyle = classColors[characterClass];
      context.fillRect(29, 48, 38, 55);
      context.fillStyle = '#1f2937';
      context.fillRect(31, 103, 13, 28);
      context.fillRect(52, 103, 13, 28);
    };

    const draw = (now: number) => {
      if (cancelled) {
        return;
      }
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (image.complete && image.naturalWidth > 0) {
        const frame = animated ? Math.floor((now - start) / 140) % 4 : 0;
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
      } else {
        drawFallback();
      }
      frameId = requestAnimationFrame(draw);
    };

    image.onload = () => {
      start = performance.now();
    };
    image.onerror = drawFallback;
    image.src = outfitImageUrl(outfitKey);
    frameId = requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [animated, characterClass, direction, outfitKey]);

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
