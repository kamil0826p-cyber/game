import { Application, Container, Rectangle, type FederatedPointerEvent } from 'pixi.js';
import type { PublicPlayerState } from '../../contracts/game';
import type { MobStatePayload } from '../../contracts/mob';
import type { NpcStatePayload } from '../../contracts/socket';
import type { LoadedMapDefinition } from '../../contracts/tiled';
import { KeyboardMovementController } from '../input/KeyboardMovementController';
import { mapRepository } from '../map/MapRepository';
import { canInteractWithNpc } from '../npc/npcInteraction';
import { findPath } from '../pathfinding/aStar';
import { GameSocketClient } from '../realtime/GameSocketClient';
import { gameStore, type GameState } from '../state/gameStore';
import { mobStore } from '../state/mobStore';
import {
  MAX_RENDER_RESOLUTION,
  MAX_VIEWPORT_HALF_HEIGHT,
  MAX_VIEWPORT_HALF_WIDTH,
  WORLD_TILE_SIZE,
} from './constants';
import { CharacterView } from './CharacterView';
import { MapRenderer } from './MapRenderer';
import { MobView, type MobInteractionPoint } from './MobView';
import { NPC_CONTEXT_EVENT, NpcView, type NpcInteractionPoint } from './NpcView';

export const LOCAL_PLAYER_SCREEN_EVENT = 'game:local-player-screen-position';
export interface LocalPlayerScreenPosition { x: number; y: number; }

export class GameEngine {
  private readonly app = new Application();
  private readonly world = new Container();
  private readonly npcLayer = new Container();
  private readonly mobLayer = new Container();
  private readonly playerLayer = new Container();
  private readonly mapRenderer = new MapRenderer();
  private readonly characterViews = new Map<string, CharacterView>();
  private readonly npcViews = new Map<string, NpcView>();
  private readonly mobViews = new Map<string, MobView>();
  private keyboard?: KeyboardMovementController;
  private currentMap?: LoadedMapDefinition;
  private currentMapIdentity = '';
  private loadSequence = 0;
  private unsubscribeStore?: () => void;
  private unsubscribeMobs?: () => void;
  private resizeObserver?: ResizeObserver;
  private cameraX = 0;
  private cameraY = 0;
  private lastViewportReport = '';
  private destroyed = false;
  private initialized = false;
  private transitionTimer?: number;

  constructor(private readonly host: HTMLElement, private readonly client: GameSocketClient) {}

  async start(): Promise<void> {
    await this.app.init({
      resizeTo: this.host,
      background: '#090b13',
      antialias: false,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, MAX_RENDER_RESOLUTION),
      powerPreference: 'high-performance',
      preference: 'webgl',
    });
    this.initialized = true;
    if (this.destroyed) { this.app.destroy(true); return; }

    this.host.appendChild(this.app.canvas);
    this.app.canvas.className = 'game-canvas';
    this.world.sortableChildren = true;
    this.npcLayer.sortableChildren = true;
    this.mobLayer.sortableChildren = true;
    this.playerLayer.sortableChildren = true;
    this.mapRenderer.container.zIndex = 0;
    this.npcLayer.zIndex = 1;
    this.mobLayer.zIndex = 1;
    this.playerLayer.zIndex = 2;
    this.world.addChild(this.mapRenderer.container, this.npcLayer, this.mobLayer, this.playerLayer);
    this.app.stage.addChild(this.world);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
    this.app.stage.on('pointerdown', this.onPointerDown);
    this.host.addEventListener('contextmenu', this.onContextMenu);

    this.keyboard = new KeyboardMovementController(this.client);
    this.unsubscribeStore = gameStore.subscribe(this.syncFromStore);
    this.unsubscribeMobs = mobStore.subscribe(this.syncMobsFromStore);
    this.resizeObserver = new ResizeObserver(() => this.onResize());
    this.resizeObserver.observe(this.host);
    this.app.ticker.add(this.tick);
    this.syncFromStore();
    this.onResize();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (!this.initialized) return;
    if (this.transitionTimer !== undefined) window.clearTimeout(this.transitionTimer);
    this.unsubscribeStore?.();
    this.unsubscribeMobs?.();
    this.resizeObserver?.disconnect();
    this.keyboard?.destroy();
    this.host.removeEventListener('contextmenu', this.onContextMenu);
    this.app.stage.off('pointerdown', this.onPointerDown);
    for (const view of this.characterViews.values()) view.destroy();
    for (const view of this.npcViews.values()) view.destroy();
    for (const view of this.mobViews.values()) view.destroy();
    this.characterViews.clear();
    this.npcViews.clear();
    this.mobViews.clear();
    this.mapRenderer.destroy();
    this.app.destroy(true, { children: true, texture: false, textureSource: false });
  }

  private readonly syncFromStore = (): void => {
    const state = gameStore.getSnapshot();
    if (state.map) {
      const identity = `${state.map.key}:${state.map.version}`;
      if (identity !== this.currentMapIdentity) {
        this.currentMapIdentity = identity;
        void this.loadMap(state.map.key, state.map.version);
      }
    }
    this.syncNpcs(state.npcs);
    this.syncMobs(Object.values(mobStore.getSnapshot()));
    this.syncCharacters(state);
  };

  private readonly syncMobsFromStore = (): void => {
    this.syncMobs(Object.values(mobStore.getSnapshot()));
  };

  private async loadMap(key: string, version: number): Promise<void> {
    const sequence = ++this.loadSequence;
    try {
      const map = await mapRepository.load(key, version);
      if (this.destroyed || sequence !== this.loadSequence) return;
      const rendered = await this.mapRenderer.load(map);
      if (!rendered || this.destroyed || sequence !== this.loadSequence) return;
      this.currentMap = map;
      this.cameraX = 0;
      this.cameraY = 0;
      const state = gameStore.getSnapshot();
      this.syncNpcs(state.npcs);
      this.syncMobs(Object.values(mobStore.getSnapshot()));
      this.syncCharacters(state, true);
      this.reportViewport();
      if (state.portalTransition !== 'idle') {
        gameStore.setPortalTransition('fade-in');
        this.transitionTimer = window.setTimeout(() => gameStore.setPortalTransition('idle'), 280);
      }
    } catch (error) {
      gameStore.setFatalError(error instanceof Error ? error.message : 'The current map could not be loaded.');
    }
  }

  private syncNpcs(npcs: readonly NpcStatePayload[]): void {
    const expected = new Map(npcs.map((npc) => [npc.id, npc]));
    for (const [npcId, view] of this.npcViews) {
      const npc = expected.get(npcId);
      if (
        !npc ||
        view.npc.x !== npc.x ||
        view.npc.y !== npc.y ||
        view.npc.name !== npc.name ||
        view.npc.outfitKey !== npc.outfitKey ||
        view.npc.interactionType !== npc.interactionType ||
        view.npc.interactionRadius !== npc.interactionRadius
      ) {
        view.destroy();
        this.npcViews.delete(npcId);
      }
    }
    for (const npc of npcs) {
      if (this.npcViews.has(npc.id)) continue;
      const view = new NpcView(npc, this.interactWithNpc);
      this.npcViews.set(npc.id, view);
      this.npcLayer.addChild(view.container);
    }
  }

  private syncMobs(mobs: readonly MobStatePayload[]): void {
    const expected = new Map(mobs.map((mob) => [mob.id, mob]));
    for (const [mobId, view] of this.mobViews) {
      const mob = expected.get(mobId);
      if (
        !mob ||
        view.mob.x !== mob.x ||
        view.mob.y !== mob.y ||
        view.mob.name !== mob.name ||
        view.mob.level !== mob.level ||
        view.mob.rank !== mob.rank ||
        view.mob.outfitKey !== mob.outfitKey
      ) {
        view.destroy();
        this.mobViews.delete(mobId);
      }
    }
    for (const mob of mobs) {
      if (this.mobViews.has(mob.id)) continue;
      const view = new MobView(mob, this.interactWithMob);
      this.mobViews.set(mob.id, view);
      this.mobLayer.addChild(view.container);
    }
  }

  private readonly interactWithNpc = (npc: NpcStatePayload, point: NpcInteractionPoint): void => {
    const state = gameStore.getSnapshot();
    const self = state.self;
    if (!self || state.phase !== 'in-world' || !state.socketConnected || state.portalTransition !== 'idle') return;
    if (!canInteractWithNpc(self, npc)) {
      gameStore.addNotification({ code: 'NPC_TOO_FAR', message: 'Podejdź bliżej do NPC, aby rozpocząć interakcję.' });
      return;
    }
    window.dispatchEvent(new CustomEvent(NPC_CONTEXT_EVENT, { detail: { npc, ...point } }));
  };

  private readonly interactWithMob = (mob: MobStatePayload, _point: MobInteractionPoint): void => {
    const state = gameStore.getSnapshot();
    const self = state.self;
    if (
      !self ||
      state.phase !== 'in-world' ||
      !state.socketConnected ||
      state.portalTransition !== 'idle' ||
      state.activeModal ||
      self.combatState !== 'IDLE'
    ) return;
    const nearby =
      self.mapId === mob.mapId &&
      Math.max(Math.abs(self.x - mob.x), Math.abs(self.y - mob.y)) <= 1;
    if (!nearby) {
      gameStore.addNotification({
        code: 'MOB_TOO_FAR',
        message: 'Podejdź obok potwora, aby go zaatakować.',
      });
      return;
    }
    void this.client.stopMovement();
    void this.client.requestMobCombat(mob.id).catch(() => undefined);
  };

  private syncCharacters(state: GameState, immediate = false): void {
    const self = state.self;
    if (!self || !state.map || !this.currentMap || state.map.key !== this.currentMap.key) return;
    const expected = new Map<string, { player: PublicPlayerState; local: boolean }>();
    expected.set(self.characterId, { player: self, local: true });
    for (const player of Object.values(state.players)) {
      if (player.mapId === self.mapId) expected.set(player.characterId, { player, local: false });
    }
    for (const [characterId, entry] of expected) {
      let view = this.characterViews.get(characterId);
      if (!view) {
        view = new CharacterView(entry.player, entry.local);
        this.characterViews.set(characterId, view);
        this.playerLayer.addChild(view.container);
        view.sync(entry.player, state.movementStepMs, true);
      } else view.sync(entry.player, state.movementStepMs, immediate);
    }
    for (const [characterId, view] of this.characterViews) {
      if (!expected.has(characterId)) {
        this.characterViews.delete(characterId);
        view.destroy();
      }
    }
  }

  private readonly tick = (): void => {
    const now = performance.now();
    this.keyboard?.update(now);
    this.mapRenderer.update(now);
    for (const view of this.characterViews.values()) view.update(now);
    this.updateCamera();
  };

  private updateCamera(): void {
    const selfId = gameStore.getSnapshot().self?.characterId;
    const localView = selfId ? this.characterViews.get(selfId) : undefined;
    if (!localView || !this.currentMap) return;
    const screenWidth = this.app.screen.width;
    const screenHeight = this.app.screen.height;
    const desiredX = this.clampCamera(localView.worldX, screenWidth, this.mapRenderer.pixelWidth);
    const desiredY = this.clampCamera(localView.worldY, screenHeight, this.mapRenderer.pixelHeight);
    this.cameraX += (desiredX - this.cameraX) * 0.15;
    this.cameraY += (desiredY - this.cameraY) * 0.15;
    this.world.position.set(screenWidth / 2 - this.cameraX, screenHeight / 2 - this.cameraY);
    this.host.dispatchEvent(new CustomEvent<LocalPlayerScreenPosition>(LOCAL_PLAYER_SCREEN_EVENT, {
      bubbles: true,
      detail: { x: localView.worldX + this.world.x, y: localView.worldY + this.world.y },
    }));
  }

  private clampCamera(value: number, viewportSize: number, worldSize: number): number {
    if (worldSize <= viewportSize) return worldSize / 2;
    const half = viewportSize / 2;
    return Math.max(half, Math.min(worldSize - half, value));
  }

  private readonly onPointerDown = (event: FederatedPointerEvent): void => {
    if (event.button !== 0) return;
    const state = gameStore.getSnapshot();
    const map = this.currentMap;
    const self = state.self;
    if (
      state.phase !== 'in-world' ||
      !state.socketConnected ||
      state.portalTransition !== 'idle' ||
      state.activeModal ||
      self?.combatState !== 'IDLE' ||
      !map ||
      !self
    ) return;

    const local = this.world.toLocal(event.global);
    const target = {
      x: Math.floor(local.x / WORLD_TILE_SIZE),
      y: Math.floor(local.y / WORLD_TILE_SIZE),
    };
    const occupied = new Set<string>();
    if (state.map?.zoneType !== 'SAFE') {
      for (const player of Object.values(state.players)) occupied.add(`${player.x},${player.y}`);
    }
    for (const npc of state.npcs) occupied.add(`${npc.x},${npc.y}`);
    for (const mob of Object.values(mobStore.getSnapshot())) occupied.add(`${mob.x},${mob.y}`);
    const path = findPath(map, { x: self.x, y: self.y }, target, {
      maxPathLength: 96,
      maxVisitedNodes: 4_096,
      isDynamicallyBlocked: (x, y) => occupied.has(`${x},${y}`),
    });

    if (path.length === 0) {
      if (target.x === self.x && target.y === self.y) void this.client.stopMovement();
      else gameStore.addNotification({ code: 'PATH_UNAVAILABLE', message: 'No walkable route reaches that tile.' });
      return;
    }
    gameStore.setPlannedPath(path);
    void this.client.requestTarget(target.x, target.y).catch(() => gameStore.clearPlannedPath());
  };

  private readonly onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
    void this.client.stopMovement();
  };

  private onResize(): void {
    if (this.destroyed) return;
    this.app.stage.hitArea = new Rectangle(0, 0, this.app.screen.width, this.app.screen.height);
    this.reportViewport();
  }

  private reportViewport(): void {
    if (!this.currentMap) return;
    const halfWidth = Math.min(
      MAX_VIEWPORT_HALF_WIDTH,
      Math.max(1, Math.ceil(this.app.screen.width / WORLD_TILE_SIZE / 2) + 2),
    );
    const halfHeight = Math.min(
      MAX_VIEWPORT_HALF_HEIGHT,
      Math.max(1, Math.ceil(this.app.screen.height / WORLD_TILE_SIZE / 2) + 2),
    );
    const key = `${halfWidth}:${halfHeight}`;
    if (key === this.lastViewportReport) return;
    this.lastViewportReport = key;
    void this.client.updateViewport(halfWidth, halfHeight);
  }
}
