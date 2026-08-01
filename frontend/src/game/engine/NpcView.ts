import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  type FederatedPointerEvent,
} from 'pixi.js';
import type { NpcStatePayload } from '../../contracts/socket';
import {
  getNpcQuestMarkerState,
  subscribeQuestMarkerState,
} from '../quests/questMarkerState';
import { WORLD_TILE_SIZE } from './constants';
import { getOutfitSheetFrames } from './OutfitSheetLoader';

export const NPC_CONTEXT_EVENT = 'game:npc-interaction';
export interface NpcInteractionPoint { x: number; y: number; }

export class NpcView {
  readonly container = new Container();
  private readonly sprite = new Sprite();
  private readonly fallback: Container;
  private unsubscribeQuestMarker?: () => void;
  private destroyed = false;

  constructor(readonly npc: NpcStatePayload, onInteract?: (npc: NpcStatePayload, point: NpcInteractionPoint) => void) {
    this.container.position.set(npc.x * WORLD_TILE_SIZE + WORLD_TILE_SIZE / 2, npc.y * WORLD_TILE_SIZE + WORLD_TILE_SIZE / 2);
    this.container.zIndex = npc.y;
    this.container.sortableChildren = true;
    this.container.eventMode = 'static';
    this.container.cursor = 'pointer';
    this.container.hitArea = new Rectangle(-22, -38, 44, 62);
    this.container.label = npc.outfitKey;

    const shadow = new Graphics().ellipse(0, 13, 14, 6).fill({ color: 0x000000, alpha: 0.35 });
    shadow.zIndex = 0;

    this.fallback = this.createFallback();
    this.fallback.zIndex = 1;

    this.sprite.anchor.set(0.5, 1);
    this.sprite.position.set(0, 18);
    this.sprite.scale.set(1.35);
    this.sprite.visible = false;
    this.sprite.zIndex = 2;

    const interactionMarker = new Text({ text: '', style: { fill: 0xfbbf24, fontSize: 16, fontWeight: 'bold', stroke: { color: 0x451a03, width: 3 } } });
    interactionMarker.anchor.set(0.5); interactionMarker.position.set(0, -56); interactionMarker.zIndex = 3;
    const refreshMarker = () => {
      if (npc.interactionType === 'MERCHANT') interactionMarker.text = '¤';
      else if (npc.interactionType !== 'QUEST') interactionMarker.text = '…';
      else {
        const state = getNpcQuestMarkerState(npc.key);
        interactionMarker.text = state === 'NOT_STARTED' ? '!' : state === 'READY' ? '?' : '';
      }
      interactionMarker.visible = interactionMarker.text.length > 0;
    };
    refreshMarker();
    if (npc.interactionType === 'QUEST') this.unsubscribeQuestMarker = subscribeQuestMarkerState(refreshMarker);

    const name = new Text({ text: npc.name, style: { fill: 0xfef3c7, fontSize: 10, fontWeight: 'bold', stroke: { color: 0x111827, width: 3 } } });
    name.anchor.set(0.5, 0); name.position.set(0, 22); name.zIndex = 3;

    this.container.addChild(shadow, this.fallback, this.sprite, interactionMarker, name);
    this.container.on('pointerdown', (event: FederatedPointerEvent) => event.stopPropagation());
    this.container.on('pointertap', (event: FederatedPointerEvent) => {
      event.stopPropagation();
      const point = { x: event.global.x, y: event.global.y };
      if (onInteract) onInteract(npc, point);
      else window.dispatchEvent(new CustomEvent(NPC_CONTEXT_EVENT, { detail: { npc, ...point } }));
    });

    void this.loadSprite();
  }

  destroy(): void {
    this.destroyed = true;
    this.unsubscribeQuestMarker?.();
    this.container.destroy({ children: true });
  }

  private async loadSprite(): Promise<void> {
    const frames = await getOutfitSheetFrames(this.npc.outfitKey);
    if (this.destroyed || !frames) return;
    const texture = frames.frames.SOUTH[0];
    if (!texture) return;
    this.sprite.texture = texture;
    this.sprite.visible = true;
    this.fallback.visible = false;
  }

  private createFallback(): Container {
    const fallback = new Container();
    if (this.npc.outfitKey === 'npc-quest-mira') {
      fallback.addChild(
        new Graphics()
          .rect(-8, -9, 16, 22).fill({ color: 0x2f766f })
          .rect(-6, -7, 12, 18).fill({ color: 0xd2a15d })
          .rect(-7, -21, 14, 13).fill({ color: 0xe7b98f })
          .rect(-9, -25, 18, 7).fill({ color: 0x6b3f28 })
          .rect(10, -5, 5, 12).fill({ color: 0xd9d0bd }),
      );
      return fallback;
    }

    fallback.addChild(
      new Graphics()
        .rect(-10, -9, 20, 22).fill({ color: 0x7c2d12 })
        .rect(-7, -6, 14, 9).fill({ color: 0xb45309 })
        .rect(-8, -22, 16, 14).fill({ color: 0xc98f62 })
        .rect(-10, -26, 20, 7).fill({ color: 0x9ca3af })
        .roundRect(-18, -7, 10, 19, 3).fill({ color: 0x78350f })
        .rect(12, -15, 2, 25).fill({ color: 0xd1d5db }),
    );
    return fallback;
  }
}
