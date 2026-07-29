import { useEffect, useRef } from 'react';
import type { CharacterClass, Direction } from '../../contracts/game';
import { getIdlePose, getWalkPose } from '../../game/engine/outfitAnimation';
import { staticOutfitLoader } from '../../game/engine/StaticOutfitLoader';

const directionRows: Record<Direction, number> = { SOUTH: 0, WEST: 1, EAST: 2, NORTH: 3 };
const classColors: Record<CharacterClass, string> = { MAGE: '#6d5bd0', WARRIOR: '#b45454', ARCHER: '#4f9467' };

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
  characterClass,
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
    const mob = outfitKey.startsWith('mob-');
    const mobImage = mob ? new Image() : undefined;
    const safeRenderScale = Math.max(0.2, Math.min(3, renderScale));
    let outfitSheet: HTMLCanvasElement | undefined;
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
      if (cancelled) return;
      context.clearRect(0, 0, canvas.width, canvas.height);

      if (mob && mobImage?.complete && mobImage.naturalWidth > 0) {
        const scale = Math.min(88 / mobImage.naturalWidth, 112 / mobImage.naturalHeight) * safeRenderScale;
        const width = mobImage.naturalWidth * scale;
        const height = mobImage.naturalHeight * scale;
        context.drawImage(mobImage, (96 - width) / 2, 144 - height - 12, width, height);
      } else if (!mob && outfitSheet) {
        const pose = animated
          ? getWalkPose(now, start, 720)
          : getIdlePose(0);
        const frame = animated ? pose.frame : 0;

        context.save();
        context.translate(48, 144 + pose.offsetY * 3);
        context.rotate(pose.rotation);
        context.scale(pose.scaleX, pose.scaleY);
        context.drawImage(
          outfitSheet,
          frame * 32,
          directionRows[direction] * 48,
          32,
          48,
          -48,
          -144,
          96,
          144,
        );
        context.restore();
      } else {
        drawFallback();
      }

      frameId = requestAnimationFrame(draw);
    };

    if (mob && mobImage) {
      mobImage.onload = () => { start = performance.now(); };
      mobImage.onerror = drawFallback;
      mobImage.src = `/assets/mobs/${encodeURIComponent(outfitKey)}.svg`;
    } else {
      void staticOutfitLoader.getSheet(outfitKey).then((sheet) => {
        if (cancelled || !sheet) return;
        outfitSheet = sheet;
        start = performance.now();
      });
    }

    frameId = requestAnimationFrame(draw);
    return () => {
      cancelled = true;
      cancelAnimationFrame(frameId);
    };
  }, [animated, characterClass, direction, outfitKey, renderScale]);

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
