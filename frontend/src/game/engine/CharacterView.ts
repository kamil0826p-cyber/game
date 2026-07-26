import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { Direction, PublicPlayerState } from '../../contracts/game';
import { WORLD_TILE_SIZE } from './constants';
import { gameAssetLoader, type OutfitFrames } from './GameAssetLoader';

const classColors = {
  MAGE: 0x6d5bd0,
  WARRIOR: 0xb45454,
  ARCHER: 0x4f9467,
} as const;

const smoothStep = (value: number): number => value * value * (3 - 2 * value);

export class CharacterView {
  readonly container = new Container();
  private readonly shadow: Graphics;
  private readonly fallback: Graphics;
  private readonly sprite = new Sprite();
  private readonly nameplate = new Container();
  private readonly nameText: Text;
  private frames: OutfitFrames | undefined = undefined;
  private destroyed = false;
  private state: PublicPlayerState;
  private startX = 0;
  private startY = 0;
  private targetX = 0;
  private targetY = 0;
  private movementStartedAt = 0;
  private movementDuration = 1;
  private moving = false;
  private lastOutfitKey = '';

  constructor(state: PublicPlayerState, private readonly localPlayer: boolean) {
    this.state = state;
    this.container.sortableChildren = true;

    this.shadow = new Graphics()
      .ellipse(0, -2, 17, 7)
      .fill({ color: 0x03040a, alpha: 0.48 });
    this.shadow.zIndex = 0;

    this.fallback = this.createFallback(state);
    this.fallback.zIndex = 1;

    this.sprite.anchor.set(0.5, 1);
    this.sprite.scale.set(1.5);
    this.sprite.zIndex = 2;
    this.sprite.visible = false;

    this.nameText = new Text({
      text: `${state.name}  Lv. ${state.level}`,
      style: {
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 12,
        fontWeight: '700',
        fill: localPlayer ? 0xfef3c7 : 0xf8fafc,
        stroke: { color: 0x05070d, width: 3 },
      },
    });
    this.nameText.anchor.set(0.5, 1);
    const badge = new Graphics()
      .roundRect(-58, -19, 116, 20, 6)
      .fill({ color: localPlayer ? 0x4c3412 : 0x111827, alpha: 0.82 })
      .stroke({ color: localPlayer ? 0xfbbf24 : 0x475569, width: 1, alpha: 0.8 });
    this.nameplate.addChild(badge, this.nameText);
    this.nameplate.position.set(0, -72);
    this.nameplate.zIndex = 4;

    if (localPlayer) {
      const selection = new Graphics()
        .ellipse(0, -1, 21, 9)
        .stroke({ color: 0xfacc15, width: 2, alpha: 0.85 });
      selection.zIndex = 3;
      this.container.addChild(selection);
    }

    this.container.addChild(this.shadow, this.fallback, this.sprite, this.nameplate);
    const x = (state.x + 0.5) * WORLD_TILE_SIZE;
    const y = (state.y + 1) * WORLD_TILE_SIZE;
    this.startX = this.targetX = x;
    this.startY = this.targetY = y;
    this.container.position.set(x, y);
    this.loadOutfit(state.outfitKey);
  }

  sync(state: PublicPlayerState, stepMs: number, immediate = false): void {
    const nextX = (state.x + 0.5) * WORLD_TILE_SIZE;
    const nextY = (state.y + 1) * WORLD_TILE_SIZE;
    const distance = Math.hypot(nextX - this.targetX, nextY - this.targetY);
    this.state = state;
    this.nameText.text = `${state.name}  Lv. ${state.level}`;

    if (state.outfitKey !== this.lastOutfitKey) {
      this.loadOutfit(state.outfitKey);
    }

    if (immediate || distance > WORLD_TILE_SIZE * 1.6) {
      this.startX = this.targetX = nextX;
      this.startY = this.targetY = nextY;
      this.container.position.set(nextX, nextY);
      this.moving = false;
      return;
    }

    if (nextX !== this.targetX || nextY !== this.targetY) {
      this.startX = this.container.x;
      this.startY = this.container.y;
      this.targetX = nextX;
      this.targetY = nextY;
      this.movementStartedAt = performance.now();
      this.movementDuration = Math.max(80, stepMs * 0.9);
      this.moving = true;
    }
  }

  update(now: number): void {
    if (this.moving) {
      const progress = Math.min(1, (now - this.movementStartedAt) / this.movementDuration);
      const eased = smoothStep(progress);
      this.container.position.set(
        this.startX + (this.targetX - this.startX) * eased,
        this.startY + (this.targetY - this.startY) * eased,
      );
      if (progress >= 1) {
        this.moving = false;
      }
    }

    this.container.zIndex = Math.round(this.container.y);
    this.shadow.scale.x = this.moving ? 1.08 : 1;
    this.updateFrame(now);
  }

  get worldX(): number {
    return this.container.x;
  }

  get worldY(): number {
    return this.container.y - WORLD_TILE_SIZE * 0.5;
  }

  destroy(): void {
    this.destroyed = true;
    this.container.destroy({ children: true });
  }

  private updateFrame(now: number): void {
    const frames = this.frames?.frames[this.state.direction];
    if (!frames || frames.length === 0) {
      return;
    }
    const duration = this.frames?.definition.frameDurationMs ?? 120;
    const index = this.moving ? Math.floor(now / duration) % frames.length : 0;
    const texture = frames[index];
    if (texture && this.sprite.texture !== texture) {
      this.sprite.texture = texture;
    }
  }

  private loadOutfit(outfitKey: string): void {
    this.lastOutfitKey = outfitKey;
    this.frames = undefined;
    this.sprite.visible = false;
    this.fallback.visible = true;
    void gameAssetLoader.getOutfitFrames(outfitKey).then((frames) => {
      if (this.destroyed || this.lastOutfitKey !== outfitKey || !frames) {
        return;
      }
      const initialTexture = frames.frames[this.state.direction]?.[0];
      if (!initialTexture) {
        return;
      }
      this.frames = frames;
      this.sprite.texture = initialTexture as Texture;
      this.sprite.visible = true;
      this.fallback.visible = false;
    });
  }

  private createFallback(state: PublicPlayerState): Graphics {
    const primary = classColors[state.characterClass];
    const accent = state.outfitKey.includes('archmage') ||
      state.outfitKey.includes('champion') ||
      state.outfitKey.includes('ranger')
      ? 0xfacc15
      : 0xdbeafe;
    return new Graphics()
      .circle(0, -51, 10)
      .fill({ color: 0xe8b98f })
      .roundRect(-12, -43, 24, 31, 7)
      .fill({ color: primary })
      .rect(-11, -29, 22, 4)
      .fill({ color: accent })
      .rect(-9, -14, 7, 14)
      .fill({ color: 0x1f2937 })
      .rect(2, -14, 7, 14)
      .fill({ color: 0x1f2937 });
  }
}
