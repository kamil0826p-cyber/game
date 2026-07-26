import type { User } from 'firebase/auth';
import { io, type Socket } from 'socket.io-client';
import { runtimeConfig } from '../../config/runtime';
import type { CharacterClass, Direction } from '../../contracts/game';
import type {
  CharacterCreateResult,
  ChatChannel,
  ChatMessagePayload,
  ClientToServerEvents,
  MovementCommittedPayload,
  MovementStopPayload,
  PathAcceptedPayload,
  ServerToClientEvents,
  SocketAck,
  SocketErrorPayload,
  VisibilityViewportPayload,
} from '../../contracts/socket';
import type { Locale } from '../../i18n/dictionaries';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';

const ACK_TIMEOUT_MS = 8_000;
const SERVER_RECONNECT_DELAY_MS = 1_200;

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type ChatListener = (message: ChatMessagePayload) => void;

export class GameSocketClient {
  private socket: GameSocket | undefined = undefined;
  private locale: Locale;
  private forceTokenRefresh = false;
  private manualDisconnect = false;
  private serverReconnectTimer: number | undefined = undefined;
  private readonly chatListeners = new Set<ChatListener>();
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
    if (this.serverReconnectTimer !== undefined) {
      window.clearTimeout(this.serverReconnectTimer);
      this.serverReconnectTimer = undefined;
    }
    this.socket?.removeAllListeners();
    this.socket?.disconnect();
    this.socket = undefined;
    this.chatListeners.clear();
    gameStore.reset();
  }

  setLocale(locale: Locale): void {
    this.locale = locale;
  }

  subscribeChat(listener: ChatListener): () => void {
    this.chatListeners.add(listener);
    return () => this.chatListeners.delete(listener);
  }

  async sendChat(channel: ChatChannel, text: string): Promise<void> {
    const socket = this.requireSocket();
    const response = await this.withAck<ChatMessagePayload>((acknowledge) => {
      socket.emit(
        'chat:send',
        { requestId: createRequestId('chat'), channel, text },
        acknowledge,
      );
    });
    if (!response.ok) {
      gameStore.addNotification(response.error);
      throw new Error(response.error.message);
    }
  }

  async createCharacter(name: string, characterClass: CharacterClass): Promise<void> {
    const socket = this.requireSocket();
    const response = await this.withAck<CharacterCreateResult>((acknowledge) => {
      socket.emit(
        'character:create',
        { requestId: createRequestId('character'), name, characterClass },
        acknowledge,
      );
    });
    if (!response.ok) {
      gameStore.addNotification(response.error);
      throw new Error(response.error.message);
    }
    gameStore.spawn(response.data);
  }

  async requestStep(direction: Direction): Promise<boolean> {
    const socket = this.requireSocket();
    const response = await this.withAck<MovementCommittedPayload>((acknowledge) => {
      socket.emit(
        'movement:step',
        { requestId: createRequestId('step'), direction },
        acknowledge,
      );
    });
    if (!response.ok && response.error.code !== 'MOVE_TOO_FAST') {
      gameStore.addNotification(response.error);
    }
    return response.ok;
  }

  async requestTarget(targetX: number, targetY: number): Promise<number> {
    const socket = this.requireSocket();
    const requestId = createRequestId('path');
    const response = await this.withAck<PathAcceptedPayload>((acknowledge) => {
      socket.emit('movement:target', { requestId, targetX, targetY }, acknowledge);
    });
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
    await this.withAck<MovementStopPayload>((acknowledge) => {
      socket.emit('movement:stop', { requestId: createRequestId('stop') }, acknowledge);
    }).catch(() => undefined);
  }

  async updateViewport(halfWidth: number, halfHeight: number): Promise<void> {
    const socket = this.socket;
    if (!socket?.connected) return;
    const response = await this.withAck<VisibilityViewportPayload>((acknowledge) => {
      socket.emit(
        'visibility:viewport',
        {
          requestId: createRequestId('viewport'),
          halfWidth: Math.max(1, Math.min(128, Math.trunc(halfWidth))),
          halfHeight: Math.max(1, Math.min(128, Math.trunc(halfHeight))),
        },
        acknowledge,
      );
    });
    if (!response.ok) gameStore.addNotification(response.error);
  }

  private bindEvents(socket: GameSocket): void {
    socket.on('connect', () => {
      if (this.serverReconnectTimer !== undefined) {
        window.clearTimeout(this.serverReconnectTimer);
        this.serverReconnectTimer = undefined;
      }
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
      if (error.message === 'AUTH_INVALID' || error.message === 'AUTH_REQUIRED') {
        this.forceTokenRefresh = true;
      }
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
    socket.on('chat:message', (payload) => {
      for (const listener of this.chatListeners) listener(payload);
    });
    socket.on('notification', (payload) => gameStore.addNotification(payload));
  }

  private scheduleServerReconnect(socket: GameSocket): void {
    if (this.serverReconnectTimer !== undefined || this.manualDisconnect) return;
    this.serverReconnectTimer = window.setTimeout(() => {
      this.serverReconnectTimer = undefined;
      if (!this.manualDisconnect && this.socket === socket && !socket.connected) {
        socket.connect();
      }
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
      const timeout = window.setTimeout(() => {
        reject(new Error('The game server did not acknowledge the request.'));
      }, ACK_TIMEOUT_MS);
      emit((response) => {
        window.clearTimeout(timeout);
        resolve(response);
      });
    });
  }
}
