import type { User } from 'firebase/auth';
import { io, type Socket } from 'socket.io-client';
import { runtimeConfig } from '../../config/runtime';
import type { CharacterClass, Direction } from '../../contracts/game';
import type {
  CharacterCreateResult,
  ChatChannel,
  ChatMessagePayload,
  ClientToServerEvents,
  CombatSnapshot,
  InventorySnapshot,
  MerchantSnapshot,
  MovementCommittedPayload,
  MovementStopPayload,
  NpcDialogueChoiceResult,
  NpcDialogueSnapshot,
  PathAcceptedPayload,
  ServerToClientEvents,
  SkillTreeSnapshot,
  SocketAck,
  SocketErrorPayload,
  TradeSnapshot,
  VisibilityViewportPayload,
  WorldSpawnPayload,
} from '../../contracts/socket';
import type { Locale } from '../../i18n/dictionaries';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';

const ACK_TIMEOUT_MS = 8_000;
const SERVER_RECONNECT_DELAY_MS = 1_200;
type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type ChatListener = (message: ChatMessagePayload) => void;
type TradeListener = (trade: TradeSnapshot) => void;
type CombatListener = (combat: CombatSnapshot) => void;
type AdminCommandAck = SocketAck<{ message: string }>;

export class GameSocketClient {
  private socket: GameSocket | undefined;
  private locale: Locale;
  private forceTokenRefresh = false;
  private manualDisconnect = false;
  private serverReconnectTimer: number | undefined;
  private readonly chatListeners = new Set<ChatListener>();
  private readonly tradeListeners = new Set<TradeListener>();
  private readonly combatListeners = new Set<CombatListener>();
  private readonly pageHideHandler = () => this.socket?.disconnect();
  private readonly pageShowHandler = () => {
    if (!this.manualDisconnect && this.socket && !this.socket.connected) {
      this.forceTokenRefresh = true;
      this.socket.connect();
    }
  };
  constructor(
    private readonly user: User,
    locale: Locale,
  ) {
    this.locale = locale;
  }

  connect(): void {
    if (this.socket) return;
    this.manualDisconnect = false;
    gameStore.markConnecting();
    const gameServerUrl = runtimeConfig.gameServerUrl.replace(/\/+$/, '');
    const socket = io(`${gameServerUrl}/game`, {
      path: runtimeConfig.socketPath,
      transports: ['websocket'],
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Number.POSITIVE_INFINITY,
      reconnectionDelay: 600,
      reconnectionDelayMax: 5_000,
      randomizationFactor: 0.35,
      timeout: 10_000,
      auth: async (callback: (credentials: object) => void) => {
        try {
          const token = await this.user.getIdToken(this.forceTokenRefresh);
          this.forceTokenRefresh = false;
          callback({ token, locale: this.locale });
        } catch {
          callback({ token: '', locale: this.locale });
        }
      },
    });
    this.socket = socket;
    this.bindEvents(socket);
    window.addEventListener('pagehide', this.pageHideHandler);
    window.addEventListener('pageshow', this.pageShowHandler);
    socket.connect();
  }
  disconnect(): void {
    this.manualDisconnect = true;
    window.removeEventListener('pagehide', this.pageHideHandler);
    window.removeEventListener('pageshow', this.pageShowHandler);
    if (this.serverReconnectTimer !== undefined) window.clearTimeout(this.serverReconnectTimer);
    this.serverReconnectTimer = undefined;
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
    this.chatListeners.clear();
    this.tradeListeners.clear();
    this.combatListeners.clear();
    gameStore.reset();
  }
  setLocale(locale: Locale): void {
    this.locale = locale;
  }
  subscribeChat(listener: ChatListener): () => void {
    this.chatListeners.add(listener);
    return () => this.chatListeners.delete(listener);
  }
  subscribeTrade(listener: TradeListener): () => void {
    this.tradeListeners.add(listener);
    return () => this.tradeListeners.delete(listener);
  }
  subscribeCombat(listener: CombatListener): () => void {
    this.combatListeners.add(listener);
    return () => this.combatListeners.delete(listener);
  }

  async sendChat(channel: ChatChannel, text: string): Promise<void> {
    if (text.trimStart().startsWith('/')) {
      const response = await this.withAck<{ message: string }>((ack) => {
        const socket = this.requireSocket() as unknown as {
          emit(
            event: 'admin:command',
            payload: { requestId: string; text: string },
            acknowledgement: (response: AdminCommandAck) => void,
          ): void;
        };
        socket.emit(
          'admin:command',
          { requestId: createRequestId('admin-command'), text },
          ack,
        );
      });
      this.assertOk(response);
      gameStore.addNotification({ code: 'ADMIN_COMMAND_OK', message: response.data.message });
      return;
    }
    const response = await this.withAck<ChatMessagePayload>((ack) =>
      this.requireSocket().emit(
        'chat:send',
        { requestId: createRequestId('chat'), channel, text },
        ack,
      ),
    );
    this.assertOk(response);
  }
  async getInventory(): Promise<InventorySnapshot> {
    return this.inventoryCommand((socket, ack) =>
      socket.emit('inventory:get', { requestId: createRequestId('inventory') }, ack),
    );
  }
  async moveInventoryItem(itemId: string, targetSlotIndex: number): Promise<InventorySnapshot> {
    return this.inventoryCommand((socket, ack) =>
      socket.emit(
        'inventory:move',
        { requestId: createRequestId('inventory-move'), itemId, targetSlotIndex },
        ack,
      ),
    );
  }
  async equipInventoryItem(itemId: string): Promise<InventorySnapshot> {
    return this.inventoryCommand((socket, ack) =>
      socket.emit(
        'inventory:equip',
        { requestId: createRequestId('inventory-equip'), itemId },
        ack,
      ),
    );
  }
  async unequipInventoryItem(itemId: string): Promise<InventorySnapshot> {
    return this.inventoryCommand((socket, ack) =>
      socket.emit(
        'inventory:unequip',
        { requestId: createRequestId('inventory-unequip'), itemId },
        ack,
      ),
    );
  }
  async useInventoryItem(itemId: string): Promise<InventorySnapshot> {
    return this.inventoryCommand((socket, ack) =>
      socket.emit(
        'inventory:use',
        { requestId: createRequestId('inventory-use'), itemId },
        ack,
      ),
    );
  }
  async discardInventoryItem(itemId: string, quantity = 1): Promise<InventorySnapshot> {
    return this.inventoryCommand((socket, ack) =>
      socket.emit(
        'inventory:discard',
        { requestId: createRequestId('inventory-discard'), itemId, quantity },
        ack,
      ),
    );
  }
  async startNpcDialogue(npcId: string): Promise<NpcDialogueSnapshot> {
    const response = await this.withAck<NpcDialogueSnapshot>((ack) =>
      this.requireSocket().emit(
        'npc:dialogue:start',
        { requestId: createRequestId('npc-dialogue-start'), npcId },
        ack,
      ),
    );
    this.assertOk(response);
    return response.data;
  }
  async chooseNpcDialogue(
    npcId: string,
    nodeId: string,
    choiceId: string,
  ): Promise<NpcDialogueChoiceResult> {
    const response = await this.withAck<NpcDialogueChoiceResult>((ack) =>
      this.requireSocket().emit(
        'npc:dialogue:choose',
        { requestId: createRequestId('npc-dialogue-choice'), npcId, nodeId, choiceId },
        ack,
      ),
    );
    this.assertOk(response);
    return response.data;
  }
  async endNpcDialogue(npcId: string): Promise<void> {
    const socket = this.socket;
    if (!socket?.connected) return;
    await this.withAck<{ closed: boolean }>((ack) =>
      socket.emit(
        'npc:dialogue:end',
        { requestId: createRequestId('npc-dialogue-end'), npcId },
        ack,
      ),
    ).catch(() => undefined);
  }
  async getMerchant(npcId: string): Promise<MerchantSnapshot> {
    return this.merchantCommand((socket, ack) =>
      socket.emit('merchant:get', { requestId: createRequestId('merchant'), npcId }, ack),
    );
  }
  async buyFromMerchant(
    npcId: string,
    itemKey: string,
    quantity = 1,
  ): Promise<MerchantSnapshot> {
    return this.merchantCommand((socket, ack) =>
      socket.emit(
        'merchant:buy',
        { requestId: createRequestId('merchant-buy'), npcId, itemKey, quantity },
        ack,
      ),
    );
  }
  async sellToMerchant(npcId: string, itemId: string, quantity = 1): Promise<MerchantSnapshot> {
    return this.merchantCommand((socket, ack) =>
      socket.emit(
        'merchant:sell',
        { requestId: createRequestId('merchant-sell'), npcId, itemId, quantity },
        ack,
      ),
    );
  }
  async getActiveTrade(): Promise<TradeSnapshot | null> {
    const response = await this.withAck<TradeSnapshot | null>((ack) =>
      this.requireSocket().emit(
        'trade:getActive',
        { requestId: createRequestId('trade-active') },
        ack,
      ),
    );
    this.assertOk(response);
    if (response.data) gameStore.updateInventoryState(response.data.inventory);
    return response.data;
  }
  async requestTrade(targetCharacterId: string): Promise<TradeSnapshot> {
    return this.tradeCommand((socket, ack) =>
      socket.emit(
        'trade:request',
        { requestId: createRequestId('trade-request'), targetCharacterId },
        ack,
      ),
    );
  }
  async respondTrade(tradeId: string, accept: boolean): Promise<TradeSnapshot> {
    return this.tradeCommand((socket, ack) =>
      socket.emit(
        'trade:respond',
        { requestId: createRequestId('trade-respond'), tradeId, accept },
        ack,
      ),
    );
  }
  async setTradeItem(
    tradeId: string,
    itemId: string,
    quantity: number,
  ): Promise<TradeSnapshot> {
    return this.tradeCommand((socket, ack) =>
      socket.emit(
        'trade:setItem',
        { requestId: createRequestId('trade-item'), tradeId, itemId, quantity },
        ack,
      ),
    );
  }
  async setTradeSilver(tradeId: string, silver: number): Promise<TradeSnapshot> {
    return this.tradeCommand((socket, ack) =>
      socket.emit(
        'trade:setSilver',
        { requestId: createRequestId('trade-silver'), tradeId, silver },
        ack,
      ),
    );
  }
  async acceptTrade(tradeId: string): Promise<TradeSnapshot> {
    return this.tradeCommand((socket, ack) =>
      socket.emit('trade:accept', { requestId: createRequestId('trade-accept'), tradeId }, ack),
    );
  }
  async cancelTrade(tradeId: string): Promise<TradeSnapshot> {
    return this.tradeCommand((socket, ack) =>
      socket.emit('trade:cancel', { requestId: createRequestId('trade-cancel'), tradeId }, ack),
    );
  }
  async getActiveCombat(): Promise<CombatSnapshot | null> {
    const response = await this.withAck<CombatSnapshot | null>((ack) =>
      this.requireSocket().emit(
        'combat:getActive',
        { requestId: createRequestId('combat-active') },
        ack,
      ),
    );
    this.assertOk(response);
    if (response.data) gameStore.updateCombatState(response.data);
    return response.data;
  }
  async requestCombat(targetCharacterId: string): Promise<CombatSnapshot> {
    return this.combatCommand((socket, ack) =>
      socket.emit(
        'combat:request',
        { requestId: createRequestId('combat-request'), targetCharacterId },
        ack,
      ),
    );
  }
  async respondCombat(combatId: string, accept: boolean): Promise<CombatSnapshot> {
    return this.combatCommand((socket, ack) =>
      socket.emit(
        'combat:respond',
        { requestId: createRequestId('combat-respond'), combatId, accept },
        ack,
      ),
    );
  }
  async performCombatAction(
    combatId: string,
    action: 'BASIC_ATTACK' | 'SKILL',
    skillKey?: string,
  ): Promise<CombatSnapshot> {
    return this.combatCommand((socket, ack) => {
      if (action === 'SKILL' && skillKey)
        socket.emit(
          'combat:act',
          {
            requestId: createRequestId('combat-skill'),
            combatId,
            action,
            skillKey,
          },
          ack,
        );
      else
        socket.emit(
          'combat:act',
          {
            requestId: createRequestId('combat-attack'),
            combatId,
            action: 'BASIC_ATTACK',
          },
          ack,
        );
    });
  }
  async leaveCombat(combatId: string): Promise<CombatSnapshot> {
    return this.combatCommand((socket, ack) =>
      socket.emit(
        'combat:leave',
        { requestId: createRequestId('combat-leave'), combatId },
        ack,
      ),
    );
  }
  async getSkills(): Promise<SkillTreeSnapshot> {
    const response = await this.withAck<SkillTreeSnapshot>((ack) =>
      this.requireSocket().emit('skills:get', { requestId: createRequestId('skills') }, ack),
    );
    this.assertOk(response);
    gameStore.updateSkillTree(response.data);
    return response.data;
  }
  async unlockSkill(skillKey: string): Promise<SkillTreeSnapshot> {
    const response = await this.withAck<SkillTreeSnapshot>((ack) =>
      this.requireSocket().emit(
        'skills:unlock',
        { requestId: createRequestId('skill-unlock'), skillKey },
        ack,
      ),
    );
    this.assertOk(response);
    gameStore.updateSkillTree(response.data);
    return response.data;
  }
  async createCharacter(name: string, characterClass: CharacterClass): Promise<void> {
    const response = await this.withAck<CharacterCreateResult>((ack) =>
      this.requireSocket().emit(
        'character:create',
        { requestId: createRequestId('character'), name, characterClass },
        ack,
      ),
    );
    this.assertOk(response);
    gameStore.spawn(response.data);
  }
  async enterWorld(): Promise<void> {
    const response = await this.withAck<WorldSpawnPayload>((ack) =>
      this.requireSocket().emit('world:enter', ack),
    );
    this.assertOk(response);
    gameStore.spawn(response.data);
    gameStore.enterWorld();
  }
  async requestStep(direction: Direction): Promise<boolean> {
    const response = await this.withAck<MovementCommittedPayload>((ack) =>
      this.requireSocket().emit(
        'movement:step',
        { requestId: createRequestId('step'), direction },
        ack,
      ),
    );
    if (!response.ok && response.error.code !== 'MOVE_TOO_FAST')
      gameStore.addNotification(response.error);
    return response.ok;
  }
  async requestTarget(targetX: number, targetY: number): Promise<number> {
    const response = await this.withAck<PathAcceptedPayload>((ack) =>
      this.requireSocket().emit(
        'movement:target',
        { requestId: createRequestId('path'), targetX, targetY },
        ack,
      ),
    );
    if (!response.ok) {
      gameStore.clearPlannedPath();
      gameStore.addNotification(response.error);
      throw new Error(response.error.message);
    }
    if (response.data.pathLength === 0) gameStore.clearPlannedPath();
    return response.data.pathLength;
  }
  async stopMovement(): Promise<void> {
    gameStore.clearPlannedPath();
    const socket = this.socket;
    if (!socket?.connected) return;
    await this.withAck<MovementStopPayload>((ack) =>
      socket.emit('movement:stop', { requestId: createRequestId('stop') }, ack),
    ).catch(() => undefined);
  }
  async updateViewport(halfWidth: number, halfHeight: number): Promise<void> {
    const socket = this.socket;
    if (!socket?.connected) return;
    const response = await this.withAck<VisibilityViewportPayload>((ack) =>
      socket.emit(
        'visibility:viewport',
        {
          requestId: createRequestId('viewport'),
          halfWidth: Math.max(1, Math.min(128, Math.trunc(halfWidth))),
          halfHeight: Math.max(1, Math.min(128, Math.trunc(halfHeight))),
        },
        ack,
      ),
    );
    if (!response.ok) gameStore.addNotification(response.error);
  }

  private async inventoryCommand(
    emit: (socket: GameSocket, ack: (response: SocketAck<InventorySnapshot>) => void) => void,
  ): Promise<InventorySnapshot> {
    const response = await this.withAck<InventorySnapshot>((ack) =>
      emit(this.requireSocket(), ack),
    );
    this.assertOk(response);
    gameStore.updateInventoryState(response.data);
    return response.data;
  }
  private async merchantCommand(
    emit: (socket: GameSocket, ack: (response: SocketAck<MerchantSnapshot>) => void) => void,
  ): Promise<MerchantSnapshot> {
    const response = await this.withAck<MerchantSnapshot>((ack) =>
      emit(this.requireSocket(), ack),
    );
    this.assertOk(response);
    gameStore.updateInventoryState(response.data.inventory);
    return response.data;
  }
  private async tradeCommand(
    emit: (socket: GameSocket, ack: (response: SocketAck<TradeSnapshot>) => void) => void,
  ): Promise<TradeSnapshot> {
    const response = await this.withAck<TradeSnapshot>((ack) =>
      emit(this.requireSocket(), ack),
    );
    this.assertOk(response);
    gameStore.updateInventoryState(response.data.inventory);
    return response.data;
  }
  private async combatCommand(
    emit: (socket: GameSocket, ack: (response: SocketAck<CombatSnapshot>) => void) => void,
  ): Promise<CombatSnapshot> {
    const response = await this.withAck<CombatSnapshot>((ack) =>
      emit(this.requireSocket(), ack),
    );
    this.assertOk(response);
    gameStore.updateCombatState(response.data);
    return response.data;
  }
  private assertOk<T>(response: SocketAck<T>): asserts response is { ok: true; data: T } {
    if (!response.ok) {
      gameStore.addNotification(response.error);
      throw new Error(response.error.message);
    }
  }
  private bindEvents(socket: GameSocket): void {
    socket.on('connect', () => {
      if (this.serverReconnectTimer !== undefined)
        window.clearTimeout(this.serverReconnectTimer);
      this.serverReconnectTimer = undefined;
      gameStore.markConnected();
    });
    socket.on('disconnect', (reason) => {
      if (this.manualDisconnect) return;
      gameStore.markDisconnected(reason);
      if (reason === 'io server disconnect') {
        this.forceTokenRefresh = true;
        this.scheduleServerReconnect(socket);
      }
    });
    socket.on('connect_error', (error) => {
      if (error.message === 'AUTH_INVALID' || error.message === 'AUTH_REQUIRED')
        this.forceTokenRefresh = true;
      gameStore.markDisconnected(error.message);
    });
    socket.io.on('reconnect_attempt', () => {
      this.forceTokenRefresh = true;
    });
    socket.on('session:ready', (payload) => gameStore.setSessionReady(payload));
    socket.on('character:required', ({ allowedClasses }) =>
      gameStore.requireCharacter(allowedClasses),
    );
    socket.on('world:spawn', (payload) => gameStore.spawn(payload));
    socket.on('world:playerEntered', (player) => gameStore.upsertPlayer(player));
    socket.on('world:playerMoved', (player) => gameStore.upsertPlayer(player));
    socket.on('world:playerLeft', ({ characterId }) => gameStore.removePlayer(characterId));
    socket.on('movement:committed', (payload) => gameStore.commitMovement(payload));
    socket.on('movement:rejected', (payload) => gameStore.rejectMovement(payload));
    socket.on('world:mapChanged', (payload) => gameStore.changeMap(payload));
    socket.on('character:currencyUpdated', (payload) => gameStore.updateCurrency(payload));
    socket.on('chat:message', (payload) => {
      for (const listener of this.chatListeners) listener(payload);
    });
    socket.on('trade:requested', (payload) => {
      gameStore.updateInventoryState(payload.inventory);
      for (const listener of this.tradeListeners) listener(payload);
    });
    socket.on('trade:updated', (payload) => {
      gameStore.updateInventoryState(payload.inventory);
      for (const listener of this.tradeListeners) listener(payload);
    });
    socket.on('combat:requested', (payload) => {
      gameStore.updateCombatState(payload);
      for (const listener of this.combatListeners) listener(payload);
    });
    socket.on('combat:updated', (payload) => {
      gameStore.updateCombatState(payload);
      for (const listener of this.combatListeners) listener(payload);
    });
    socket.on('notification', (payload) => gameStore.addNotification(payload));
  }
  private scheduleServerReconnect(socket: GameSocket): void {
    if (this.serverReconnectTimer !== undefined || this.manualDisconnect) return;
    this.serverReconnectTimer = window.setTimeout(() => {
      this.serverReconnectTimer = undefined;
      if (!this.manualDisconnect && this.socket === socket && !socket.connected)
        socket.connect();
    }, SERVER_RECONNECT_DELAY_MS);
  }
  private requireSocket(): GameSocket {
    if (!this.socket?.connected) {
      const error: SocketErrorPayload = {
        code: 'SOCKET_DISCONNECTED',
        message: 'The game socket is not connected.',
      };
      gameStore.addNotification(error);
      throw new Error(error.message);
    }
    return this.socket;
  }
  private withAck<T>(
    emit: (acknowledge: (response: SocketAck<T>) => void) => void,
  ): Promise<SocketAck<T>> {
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('The game server did not acknowledge the request.')),
        ACK_TIMEOUT_MS,
      );
      emit((response) => {
        window.clearTimeout(timeout);
        resolve(response);
      });
    });
  }
}
