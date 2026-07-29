import { Container, Graphics, Rectangle, Sprite, Text, type FederatedPointerEvent, type Texture } from 'pixi.js';
import type { PublicPlayerState } from '../../contracts/game';
import { WORLD_TILE_SIZE } from './constants';
import { gameAssetLoader, type OutfitFrames } from './GameAssetLoader';

export const PLAYER_CONTEXT_EVENT = 'game:player-interaction';
export interface CharacterInteractionPoint { x: number; y: number; }

export class CharacterView {
  readonly container = new Container();
  private readonly shadow: Graphics;
  private readonly sprite = new Sprite();
  private readonly nameplate = new Container();
  private readonly nameText: Text;
  private frames: OutfitFrames | undefined;
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

  constructor(
    state: PublicPlayerState,
    private readonly localPlayer: boolean,
    onInteract?: (player: PublicPlayerState, point: CharacterInteractionPoint) => void,
  ) {
    this.state = state;
    this.container.sortableChildren = true;

    if (!localPlayer) {
      this.container.eventMode = 'static';
      this.container.cursor = 'pointer';
      this.container.hitArea = new Rectangle(-24, -78, 48, 82);
      this.container.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
      this.container.on('pointertap', (event: FederatedPointerEvent) => {
        event.stopPropagation();
        const point = { x: event.global.x, y: event.global.y };
        if (onInteract) onInteract(this.state, point);
        else window.dispatchEvent(new CustomEvent(PLAYER_CONTEXT_EVENT, { detail: { player: this.state, ...point } }));
      });
    }

    this.shadow = new Graphics().ellipse(0, -2, 17, 7).fill({ color: 0x03040a, alpha: 0.48 });
    this.shadow.zIndex = 0;
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
    this.container.addChild(this.shadow, this.sprite, this.nameplate);

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
    if (state.outfitKey !== this.lastOutfitKey) this.loadOutfit(state.outfitKey);

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
      this.movementDuration = Math.max(80, stepMs * 1.05);
      this.moving = true;
    }
  }

  update(now: number): void {
    if (this.moving) {
      const progress = Math.min(1, (now - this.movementStartedAt) / this.movementDuration);
      this.container.position.set(
        this.startX + (this.targetX - this.startX) * progress,
        this.startY + (this.targetY - this.startY) * progress,
      );
      if (progress >= 1) this.moving = false;
    }
    this.container.zIndex = Math.round(this.container.y);
    this.shadow.scale.x = this.moving ? 1.08 : 1;
    this.updateFrame(now);
  }

  get worldX(): number { return this.container.x; }
  get worldY(): number { return this.container.y - WORLD_TILE_SIZE * 0.5; }

  destroy(): void {
    this.destroyed = true;
    this.container.destroy({ children: true });
  }

  private updateFrame(now: number): void {
    const frames = this.frames?.frames[this.state.direction];
    if (!frames?.length) return;
    const duration = this.frames?.definition.frameDurationMs ?? 120;
    const index = this.moving
      ? Math.floor((now - this.movementStartedAt) / duration) % frames.length
      : 0;
    const texture = frames[index];
    if (texture && this.sprite.texture !== texture) this.sprite.texture = texture;
  }

  private loadOutfit(outfitKey: string): void {
    this.lastOutfitKey = outfitKey;
    this.frames = undefined;
    this.sprite.visible = false;

    void gameAssetLoader.getOutfitFrames(outfitKey).then((frames) => {
      if (this.destroyed || this.lastOutfitKey !== outfitKey) return;
      if (!frames) {
        console.error(`Outfit frames failed to load for ${outfitKey}.`);
        return;
      }
      const initialTexture = frames.frames[this.state.direction]?.[0];
      if (!initialTexture) {
        console.error(`Outfit ${outfitKey} has no frame for direction ${this.state.direction}.`);
        return;
      }
      this.frames = frames;
      this.sprite.texture = initialTexture as Texture;
      this.sprite.visible = true;
    });
  }
}
