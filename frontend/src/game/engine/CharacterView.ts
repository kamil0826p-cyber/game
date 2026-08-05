import { Container, Graphics, Rectangle, Sprite, Text, type FederatedPointerEvent, type Texture } from 'pixi.js';
import type { PublicPlayerState } from '../../contracts/game';
import { isGroupMate, subscribeGroupPresence } from '../groups/groupPresence';
import { isGuildMate, subscribeGuildPresence } from '../guilds/guildPresence';
import { WORLD_TILE_SIZE } from './constants';
import { getOutfitSheetFrames, type OutfitSheetFrames } from './OutfitSheetLoader';
import { OUTFIT_WORLD_SCALE } from './outfitSpriteMetrics';

export const PLAYER_CONTEXT_EVENT = 'game:player-interaction';
export interface CharacterInteractionPoint { x: number; y: number; }

export class CharacterView {
  readonly container = new Container();
  private readonly shadow: Graphics;
  private readonly sprite = new Sprite();
  private readonly nameplate = new Container();
  private readonly badge = new Graphics();
  private readonly groupMark = new Graphics();
  private readonly nameText: Text;
  private readonly unsubscribeGuildPresence: () => void;
  private readonly unsubscribeGroupPresence: () => void;
  private frames: OutfitSheetFrames | undefined;
  private destroyed = false;
  private state: PublicPlayerState;
  private startX = 0;
  private startY = 0;
  private targetX = 0;
  private targetY = 0;
  private movementStartedAt = 0;
  private movementDuration = 1;
  private moving = false;
  private lastAppearanceKey = '';

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
    this.sprite.scale.set(OUTFIT_WORLD_SCALE);
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
    this.groupMark.position.set(-47, 0);
    this.nameplate.addChild(this.badge, this.groupMark, this.nameText);
    this.nameplate.position.set(0, -72);
    this.nameplate.zIndex = 4;
    this.container.addChild(this.shadow, this.sprite, this.nameplate);
    this.updateBadgeStyle();
    this.unsubscribeGuildPresence = subscribeGuildPresence(() => this.updateBadgeStyle());
    this.unsubscribeGroupPresence = subscribeGroupPresence(() => this.updateBadgeStyle());

    const x = (state.x + 0.5) * WORLD_TILE_SIZE;
    const y = (state.y + 1) * WORLD_TILE_SIZE;
    this.startX = this.targetX = x;
    this.startY = this.targetY = y;
    this.container.position.set(x, y);
    this.loadOutfit(state.outfitKey, state.gender ?? 'MALE');
  }

  sync(state: PublicPlayerState, stepMs: number, immediate = false): void {
    const nextX = (state.x + 0.5) * WORLD_TILE_SIZE;
    const nextY = (state.y + 1) * WORLD_TILE_SIZE;
    const distance = Math.hypot(nextX - this.targetX, nextY - this.targetY);
    this.state = state;
    this.nameText.text = `${state.name}  Lv. ${state.level}`;
    this.updateBadgeStyle();
    const appearanceKey = `${state.gender ?? 'MALE'}:${state.outfitKey}`;
    if (appearanceKey !== this.lastAppearanceKey) {
      this.loadOutfit(state.outfitKey, state.gender ?? 'MALE');
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
    this.unsubscribeGuildPresence();
    this.unsubscribeGroupPresence();
    this.container.destroy({ children: true });
  }

  private updateBadgeStyle(): void {
    const guildMate = !this.localPlayer && isGuildMate(this.state.characterId);
    const groupMate = !this.localPlayer && isGroupMate(this.state.characterId);
    const fill = this.localPlayer ? 0x4c3412 : guildMate ? 0x103f3a : 0x111827;
    const stroke = this.localPlayer ? 0xfbbf24 : guildMate ? 0x34d399 : 0x475569;
    this.badge
      .clear()
      .roundRect(-58, -19, 116, 20, 6)
      .fill({ color: fill, alpha: 0.86 })
      .stroke({ color: stroke, width: guildMate ? 2 : 1, alpha: 0.9 });

    this.groupMark.clear();
    if (groupMate) {
      this.groupMark
        .circle(-2.75, -12, 2.25)
        .circle(2.75, -12, 2.25)
        .fill({ color: 0xcffafe, alpha: 1 })
        .roundRect(-5.5, -9, 5, 4.5, 2)
        .roundRect(0.5, -9, 5, 4.5, 2)
        .fill({ color: 0x22d3ee, alpha: 0.96 });
    }
    this.groupMark.visible = groupMate;
  }

  private updateFrame(now: number): void {
    const frames = this.frames?.frames[this.state.direction];
    if (!frames?.length) return;
    const duration = this.frames?.frameDurationMs ?? 120;
    const index = this.moving
      ? Math.floor((now - this.movementStartedAt) / duration) % frames.length
      : 0;
    const texture = frames[index];
    if (texture && this.sprite.texture !== texture) this.sprite.texture = texture;
  }

  private loadOutfit(
    outfitKey: string,
    gender: NonNullable<PublicPlayerState['gender']>,
  ): void {
    const appearanceKey = `${gender}:${outfitKey}`;
    this.lastAppearanceKey = appearanceKey;
    this.frames = undefined;
    this.sprite.visible = false;

    void getOutfitSheetFrames(outfitKey, gender).then((frames) => {
      if (this.destroyed || this.lastAppearanceKey !== appearanceKey) return;
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
