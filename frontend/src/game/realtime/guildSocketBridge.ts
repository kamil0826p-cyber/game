import type { Socket } from 'socket.io-client';
import type {
  GuildChatMessagePayload,
  GuildRole,
  GuildSnapshot,
} from '../../contracts/guild';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAck,
} from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { clearGuildPresence, setGuildPresence } from '../guilds/guildPresence';
import { gameStore } from '../state/gameStore';
import type { GameSocketClient } from './GameSocketClient';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type GuildListener = (snapshot: GuildSnapshot) => void;
type GuildChatListener = (message: GuildChatMessagePayload) => void;
interface BridgeClient {
  socket?: GameSocket;
  connect(): void;
  disconnect(): void;
}

declare module './GameSocketClient' {
  interface GameSocketClient {
    subscribeGuild(listener: GuildListener): () => void;
    subscribeGuildChat(listener: GuildChatListener): () => void;
    getGuild(): Promise<GuildSnapshot>;
    createGuild(input: { name: string; tag: string; description: string }): Promise<GuildSnapshot>;
    inviteToGuild(characterName: string): Promise<GuildSnapshot>;
    respondGuildInvite(inviteId: string, accept: boolean): Promise<GuildSnapshot>;
    updateGuildDescription(description: string): Promise<GuildSnapshot>;
    depositGuildSilver(amount: number): Promise<GuildSnapshot>;
    withdrawGuildSilver(amount: number): Promise<GuildSnapshot>;
    buyGuildExperienceUpgrade(): Promise<GuildSnapshot>;
    setGuildRole(targetCharacterId: string, role: Exclude<GuildRole, 'LEADER'>): Promise<GuildSnapshot>;
    kickGuildMember(targetCharacterId: string): Promise<GuildSnapshot>;
    leaveGuild(): Promise<GuildSnapshot>;
    transferGuildLeadership(targetCharacterId: string): Promise<GuildSnapshot>;
    disbandGuild(): Promise<GuildSnapshot>;
    sendGuildChat(text: string): Promise<void>;
  }
}

const ACK_TIMEOUT_MS = 8_000;

function isPolishUi(): boolean {
  return document.documentElement.lang.toLowerCase().startsWith('pl');
}

export function installGuildSocketBridge(client: GameSocketClient): void {
  const bridge = client as unknown as BridgeClient;
  const originalConnect = client.connect.bind(client);
  const originalDisconnect = client.disconnect.bind(client);
  const guildListeners = new Set<GuildListener>();
  const chatListeners = new Set<GuildChatListener>();
  let boundSocket: GameSocket | undefined;
  let seenInviteIds = new Set<string>();

  const withAck = <T>(emit: (ack: (response: SocketAck<T>) => void) => void): Promise<T> =>
    new Promise<SocketAck<T>>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('The game server did not acknowledge the request.')),
        ACK_TIMEOUT_MS,
      );
      emit((response) => {
        window.clearTimeout(timeout);
        resolve(response);
      });
    }).then((response) => {
      if (!response.ok) {
        gameStore.addNotification(response.error);
        throw new Error(response.error.message);
      }
      return response.data;
    });

  const requireSocket = (): GameSocket => {
    const socket = bridge.socket;
    if (!socket?.connected) throw new Error('The game socket is not connected.');
    return socket;
  };

  const publishSnapshot = (snapshot: GuildSnapshot): GuildSnapshot => {
    const nextInviteIds = new Set(snapshot.invites.map((invite) => invite.inviteId));
    for (const invite of snapshot.invites) {
      if (seenInviteIds.has(invite.inviteId)) continue;
      gameStore.addNotification({
        code: 'GUILD_INVITE_RECEIVED',
        message: isPolishUi()
          ? `${invite.inviterName} zaprasza cię do gildii ${invite.guildName} [${invite.guildTag}].`
          : `${invite.inviterName} invited you to ${invite.guildName} [${invite.guildTag}].`,
      });
    }
    seenInviteIds = nextInviteIds;
    setGuildPresence(snapshot);
    for (const listener of guildListeners) listener(snapshot);
    return snapshot;
  };

  const command = (
    emit: (socket: GameSocket, ack: (response: SocketAck<GuildSnapshot>) => void) => void,
  ): Promise<GuildSnapshot> =>
    withAck<GuildSnapshot>((ack) => emit(requireSocket(), ack)).then(publishSnapshot);

  const bind = (): void => {
    const socket = bridge.socket;
    if (!socket || socket === boundSocket) return;
    boundSocket = socket;
    socket.on('guild:updated', publishSnapshot);
    socket.on('guild:chatMessage', (message) => {
      for (const listener of chatListeners) listener(message);
    });
  };

  bridge.connect = () => {
    originalConnect();
    bind();
  };
  bridge.disconnect = () => {
    boundSocket = undefined;
    seenInviteIds = new Set();
    guildListeners.clear();
    chatListeners.clear();
    clearGuildPresence();
    originalDisconnect();
  };

  client.subscribeGuild = (listener) => {
    guildListeners.add(listener);
    return () => guildListeners.delete(listener);
  };
  client.subscribeGuildChat = (listener) => {
    chatListeners.add(listener);
    return () => chatListeners.delete(listener);
  };
  client.getGuild = () => command((socket, ack) =>
    socket.emit('guild:get', { requestId: createRequestId('guild') }, ack));
  client.createGuild = (input) => command((socket, ack) =>
    socket.emit('guild:create', { requestId: createRequestId('guild-create'), ...input }, ack));
  client.inviteToGuild = (characterName) => command((socket, ack) =>
    socket.emit('guild:invite', { requestId: createRequestId('guild-invite'), characterName }, ack));
  client.respondGuildInvite = (inviteId, accept) => command((socket, ack) =>
    socket.emit('guild:respond', { requestId: createRequestId('guild-respond'), inviteId, accept }, ack));
  client.updateGuildDescription = (description) => command((socket, ack) =>
    socket.emit('guild:updateDescription', { requestId: createRequestId('guild-description'), description }, ack));
  client.depositGuildSilver = (amount) => command((socket, ack) =>
    socket.emit('guild:depositSilver', { requestId: createRequestId('guild-deposit'), amount }, ack));
  client.withdrawGuildSilver = (amount) => command((socket, ack) =>
    socket.emit('guild:withdrawSilver', { requestId: createRequestId('guild-withdraw'), amount }, ack));
  client.buyGuildExperienceUpgrade = () => command((socket, ack) =>
    socket.emit('guild:buyExperienceUpgrade', { requestId: createRequestId('guild-upgrade') }, ack));
  client.setGuildRole = (targetCharacterId, role) => command((socket, ack) =>
    socket.emit('guild:setRole', { requestId: createRequestId('guild-role'), targetCharacterId, role }, ack));
  client.kickGuildMember = (targetCharacterId) => command((socket, ack) =>
    socket.emit('guild:kick', { requestId: createRequestId('guild-kick'), targetCharacterId }, ack));
  client.leaveGuild = () => command((socket, ack) =>
    socket.emit('guild:leave', { requestId: createRequestId('guild-leave') }, ack));
  client.transferGuildLeadership = (targetCharacterId) => command((socket, ack) =>
    socket.emit('guild:transferLeadership', { requestId: createRequestId('guild-transfer'), targetCharacterId }, ack));
  client.disbandGuild = () => command((socket, ack) =>
    socket.emit('guild:disband', { requestId: createRequestId('guild-disband') }, ack));
  client.sendGuildChat = async (text) => {
    await withAck<GuildChatMessagePayload>((ack) =>
      requireSocket().emit('guild:chatSend', { requestId: createRequestId('guild-chat'), text }, ack));
  };
}
