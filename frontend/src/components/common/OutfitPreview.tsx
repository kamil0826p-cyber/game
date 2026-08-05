import { useEffect, useRef } from 'react';
import type { CharacterClass, CharacterGender, Direction } from '../../contracts/game';
import {
  OUTFIT_FRAME_HEIGHT,
  OUTFIT_FRAME_WIDTH,
  OUTFIT_SHEET_HEIGHT,
  OUTFIT_SHEET_WIDTH,
} from '../../game/engine/outfitSpriteMetrics';
import { outfitImageUrl } from '../../mock/outfitCatalog';

const directionRows: Record<Direction, number> = { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 };

interface OutfitPreviewProps {
  outfitKey: string;
  characterClass: CharacterClass;
  gender?: CharacterGender;
  direction?: Direction;
  size?: 'small' | 'large';
  animated?: boolean;
  renderScale?: number;
  className?: string;
}

export function OutfitPreview({
  outfitKey,
  characterClass: _characterClass,
  gender = 'MALE',
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
    const sourceUrl = mob
      ? `${import.meta.env.BASE_URL}assets/mobs/${encodeURIComponent(outfitKey)}.svg`
      : outfitImageUrl(outfitKey, gender);
    const safeRenderScale = Math.max(0.2, Math.min(3, renderScale));

    let frameId = 0;
    let start = performance.now();
    let loaded = false;
    let cancelled = false;

    const draw = (now: number) => {
      if (cancelled) return;
      context.clearRect(0, 0, canvas.width, canvas.height);

      if (loaded && image.naturalWidth > 0) {
        if (mob) {
          const scale =
            Math.min(88 / image.naturalWidth, 112 / image.naturalHeight) * safeRenderScale;
          const width = image.naturalWidth * scale;
          const height = image.naturalHeight * scale;
          context.drawImage(
            image,
            (OUTFIT_FRAME_WIDTH - width) / 2,
            OUTFIT_FRAME_HEIGHT - height - 12,
            width,
            height,
          );
        } else {
          const frame = animated ? Math.floor((now - start) / 120) % 4 : 0;
          context.drawImage(
            image,
            frame * OUTFIT_FRAME_WIDTH,
            directionRows[direction] * OUTFIT_FRAME_HEIGHT,
            OUTFIT_FRAME_WIDTH,
            OUTFIT_FRAME_HEIGHT,
            0,
            0,
            OUTFIT_FRAME_WIDTH,
            OUTFIT_FRAME_HEIGHT,
          );
        }
      }

      frameId = requestAnimationFrame(draw);
    };

    image.onload = () => {
      if (cancelled) return;
      const validSheet =
        mob ||
        (image.naturalWidth === OUTFIT_SHEET_WIDTH &&
          image.naturalHeight === OUTFIT_SHEET_HEIGHT);
      if (!validSheet) {
        console.error(
          `Outfit ${outfitKey} has invalid dimensions ${image.naturalWidth}x${image.naturalHeight}. Expected ${OUTFIT_SHEET_WIDTH}x${OUTFIT_SHEET_HEIGHT}.`,
        );
        return;
      }
      loaded = true;
      start = performance.now();
    };

    image.onerror = () => {
      if (cancelled) return;
      console.error(`Outfit image failed to load: ${sourceUrl}`);
    };

    image.src = sourceUrl;
    frameId = requestAnimationFrame(draw);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
      image.onload = null;
      image.onerror = null;
    };
  }, [animated, direction, gender, outfitKey, renderScale]);

  return (
    <canvas
      ref={canvasRef}
      width={OUTFIT_FRAME_WIDTH}
      height={OUTFIT_FRAME_HEIGHT}
      className={`pixelated ${size === 'small' ? 'h-20 w-14' : 'h-36 w-24'} ${className}`}
      aria-label={`${outfitKey} animated outfit preview`}
    />
  );
}
