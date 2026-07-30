import { useSyncExternalStore } from 'react';
import type {
  CharacterClass,
  Coordinates,
  MapStatePayload,
  PublicPlayerState,
  RealmState,
  SelfCharacterState,
} from '../../contracts/game';
import type {
  CharacterCurrencyUpdatedPayload,
  CombatSnapshot,
  InventorySnapshot,
  MovementCommittedPayload,
  MovementRejectedPayload,
  NpcStatePayload,
  SessionReadyPayload,
  SkillTreeSnapshot,
  SocketErrorPayload,
  WorldSpawnPayload,
} from '../../contracts/socket';

export type GamePhase =
  | 'idle'
  | 'connecting'
  | 'character-required'
  | 'character-select'
  | 'in-world'
  | 'reconnecting'
  | 'fatal';
export type PortalTransitionState = 'idle' | 'fade-out' | 'loading' | 'fade-in';
export type ModalKey =
  | 'character'
  | 'inventory'
  | 'npc-dialogue'
  | 'merchant'
  | 'trade'
  | 'combat'
  | 'quests'
  | 'skills'
  | null;
export interface ClientNotification extends SocketErrorPayload {
  id: string;
  createdAt: number;
}
export interface GameState {
  phase: GamePhase;
  socketConnected: boolean;
  desiredInWorld: boolean;
  realm: RealmState | undefined;
  allowedClasses: CharacterClass[];
  self: SelfCharacterState | undefined;
  map: MapStatePayload | undefined;
  npcs: readonly NpcStatePayload[];
  players: Readonly<Record<string, PublicPlayerState>>;
  unlockedOutfits: Array<{ key: string; unlockLevel: number }>;
  skillTree: SkillTreeSnapshot | undefined;
  movementStepMs: number;
  plannedPath: readonly Coordinates[];
  portalTransition: PortalTransitionState;
  activeModal: ModalKey;
  notifications: readonly ClientNotification[];
  fatalError: string | undefined;
}
const initialState = (): GameState => ({
  phase: 'idle',
  socketConnected: false,
  desiredInWorld: false,
  realm: undefined,
  allowedClasses: [],
  self: undefined,
  map: undefined,
  npcs: [],
  players: {},
  unlockedOutfits: [],
  skillTree: undefined,
  movementStepMs: 200,
  plannedPath: [],
  portalTransition: 'idle',
  activeModal: null,
  notifications: [],
  fatalError: undefined,
});

class GameStore {
  private state: GameState = initialState();
  private readonly listeners = new Set<() => void>();
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): GameState => this.state;
  reset(): void {
    this.state = initialState();
    this.emit();
  }
  markConnecting(): void {
    this.patch({ phase: 'connecting', socketConnected: false, fatalError: undefined });
  }
  markConnected(): void {
    this.patch({ socketConnected: true });
  }
  setSessionReady(payload: SessionReadyPayload): void {
    this.patch({
      realm: payload.realm,
      phase: payload.requiresCharacter ? 'character-required' : 'connecting',
    });
  }
  requireCharacter(allowedClasses: CharacterClass[]): void {
    this.patch({ phase: 'character-required', allowedClasses: [...allowedClasses] });
  }
  spawn(payload: WorldSpawnPayload): void {
    this.patch({
      phase: this.state.desiredInWorld ? 'in-world' : 'character-select',
      socketConnected: true,
      self: payload.self,
      map: payload.map,
      npcs: [...payload.npcs],
      players: Object.fromEntries(
        payload.nearbyPlayers.map((player) => [player.characterId, player]),
      ),
      unlockedOutfits: [...payload.unlockedOutfits],
      skillTree: payload.skillTree,
      movementStepMs: payload.movementStepMs,
      plannedPath: [],
      portalTransition: 'idle',
      activeModal: null,
      fatalError: undefined,
    });
  }
  enterWorld(): void {
    if (this.state.self && this.state.map)
      this.patch({ desiredInWorld: true, phase: 'in-world' });
  }
  markDisconnected(reason?: string): void {
    if (this.state.phase === 'idle') return;
    this.patch({
      socketConnected: false,
      phase: this.state.desiredInWorld ? 'reconnecting' : 'connecting',
      plannedPath: [],
      activeModal: null,
    });
    if (reason && reason !== 'io client disconnect')
      this.addNotification({ code: 'SOCKET_DISCONNECTED', message: reason });
  }
  setFatalError(message: string): void {
    this.patch({ phase: 'fatal', socketConnected: false, fatalError: message });
  }
  commitMovement(payload: MovementCommittedPayload): void {
    const self = this.state.self;
    if (!self) return;
    this.patch({
      self: {
        ...self,
        mapId: payload.mapId,
        x: payload.x,
        y: payload.y,
        direction: payload.direction,
      },
      plannedPath: this.consumePath(payload.x, payload.y),
      portalTransition: payload.portalTransition ? 'fade-out' : this.state.portalTransition,
    });
  }
  rejectMovement(payload: MovementRejectedPayload): void {
    const self = this.state.self;
    this.patch({
      self: self
        ? {
            ...self,
            mapId: payload.authoritative.mapId,
            x: payload.authoritative.x,
            y: payload.authoritative.y,
            direction: payload.authoritative.direction,
          }
        : self,
      plannedPath: [],
    });
    if (payload.code !== 'MOVE_TOO_FAST') this.addNotification(payload);
  }
  changeMap(payload: {
    map: MapStatePayload;
    npcs: NpcStatePayload[];
    self: SelfCharacterState;
    nearbyPlayers: PublicPlayerState[];
  }): void {
    this.patch({
      map: payload.map,
      npcs: [...payload.npcs],
      self: payload.self,
      players: Object.fromEntries(
        payload.nearbyPlayers.map((player) => [player.characterId, player]),
      ),
      plannedPath: [],
      portalTransition: 'loading',
      activeModal: null,
    });
  }
  setPortalTransition(portalTransition: PortalTransitionState): void {
    this.patch({ portalTransition });
  }
  setPlannedPath(path: readonly Coordinates[]): void {
    this.patch({ plannedPath: [...path] });
  }
  clearPlannedPath(): void {
    if (this.state.plannedPath.length > 0) this.patch({ plannedPath: [] });
  }
  upsertPlayer(player: PublicPlayerState): void {
    this.patch({ players: { ...this.state.players, [player.characterId]: player } });
  }
  removePlayer(characterId: string): void {
    if (!this.state.players[characterId]) return;
    const players = { ...this.state.players };
    delete players[characterId];
    this.patch({ players });
  }
  setActiveModal(activeModal: ModalKey): void {
    this.patch({ activeModal });
  }
  updateCurrency(payload: CharacterCurrencyUpdatedPayload): void {
    const self = this.state.self;
    if (!self || self.characterId !== payload.characterId) return;
    this.patch({
      self:
        payload.currency === 'SILVER'
          ? { ...self, silver: payload.balance }
          : { ...self, gold: payload.balance },
    });
  }
  updateInventoryState(snapshot: InventorySnapshot): void {
    const self = this.state.self;
    if (!self) return;
    const character = snapshot.character;
    this.patch({
      self: {
        ...self,
        silver: character?.silver ?? snapshot.silver,
        hp: character?.hp ?? self.hp,
        maxHp: character?.maxHp ?? self.maxHp,
        energy: character?.energy ?? self.energy,
        maxEnergy: character?.maxEnergy ?? self.maxEnergy,
        strength: character?.strength ?? self.strength,
        agility: character?.agility ?? self.agility,
        intelligence: character?.intelligence ?? self.intelligence,
        armor: character?.armor ?? self.armor,
      },
    });
  }
  updateSkillTree(skillTree: SkillTreeSnapshot): void {
    this.patch({ skillTree });
  }
  updateCombatState(combat: CombatSnapshot): void {
    const self = this.state.self;
    if (!self) return;
    const participant = combat.participants.find(
      (candidate) => candidate.characterId === self.characterId,
    );
    if (!participant) return;
    const combatActive = combat.status === 'ACTIVE';
    const participantActive = combatActive && participant.hp > 0 && !participant.withdrawn;
    const cooldowns = new Map(
      participant.skills.map((skill) => [skill.key, skill.cooldownTurnsRemaining]),
    );
    const players = { ...this.state.players };
    for (const combatant of combat.participants) {
      if (!combatant.characterId || combatant.characterId === self.characterId) continue;
      const player = players[combatant.characterId];
      if (player) {
        const combatantActive = combatActive && combatant.hp > 0 && !combatant.withdrawn;
        players[combatant.characterId] = {
          ...player,
          combatState: combatantActive ? 'IN_BATTLE' : 'IDLE',
        };
      }
    }
    this.patch({
      self: {
        ...self,
        combatState: participantActive ? 'IN_BATTLE' : 'IDLE',
        hp: participantActive ? participant.hp : Math.max(1, participant.hp),
        energy: participant.energy,
      },
      players,
      skillTree: this.state.skillTree
        ? {
            ...this.state.skillTree,
            skills: this.state.skillTree.skills.map((skill) => ({
              ...skill,
              cooldownTurnsRemaining: cooldowns.get(skill.key) ?? skill.cooldownTurnsRemaining,
            })),
          }
        : undefined,
      plannedPath: participantActive ? [] : this.state.plannedPath,
    });
  }
  addNotification(payload: SocketErrorPayload): void {
    if (payload.code === 'MOVE_COLLISION') return;
    const createdAt = Date.now();
    const previous = this.state.notifications.at(-1);
    if (
      previous &&
      previous.code === payload.code &&
      previous.message === payload.message &&
      createdAt - previous.createdAt < 500
    )
      return;
    const notification: ClientNotification = {
      ...payload,
      id: `${createdAt}-${Math.random().toString(36).slice(2)}`,
      createdAt,
    };
    this.patch({ notifications: [...this.state.notifications.slice(-5), notification] });
  }
  dismissNotification(id: string): void {
    this.patch({ notifications: this.state.notifications.filter((item) => item.id !== id) });
  }
  private consumePath(x: number, y: number): readonly Coordinates[] {
    const index = this.state.plannedPath.findIndex(
      (coordinate) => coordinate.x === x && coordinate.y === y,
    );
    return index >= 0 ? this.state.plannedPath.slice(index + 1) : this.state.plannedPath;
  }
  private patch(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }
  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}
export const gameStore = new GameStore();
export const useGameState = (): GameState =>
  useSyncExternalStore(gameStore.subscribe, gameStore.getSnapshot, gameStore.getSnapshot);
