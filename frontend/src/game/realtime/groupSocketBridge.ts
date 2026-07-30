import type { Socket } from 'socket.io-client';
import type { GroupSnapshot } from '../../contracts/group';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAck,
} from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { groupStore } from '../state/groupStore';
import { gameStore } from '../state/gameStore';
import type { GameSocketClient } from './GameSocketClient';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type GroupListener = (snapshot: GroupSnapshot) => void;
interface BridgeClient {
  socket?: GameSocket;
  connect(): void;
  disconnect(): void;
}

declare module './GameSocketClient' {
  interface GameSocketClient {
    subscribeGroup(listener: GroupListener): () => void;
    getGroup(): Promise<GroupSnapshot>;
    inviteToGroup(targetCharacterId: string): Promise<GroupSnapshot>;
    respondGroupInvite(inviteId: string, accept: boolean): Promise<GroupSnapshot>;
    leaveGroup(): Promise<GroupSnapshot>;
  }
}

const ACK_TIMEOUT_MS = 8_000;

function isPolishUi(): boolean {
  return document.documentElement.lang.toLowerCase().startsWith('pl');
}

export function installGroupSocketBridge(client: GameSocketClient): void {
  const bridge = client as unknown as BridgeClient;
  const originalConnect = client.connect.bind(client);
  const originalDisconnect = client.disconnect.bind(client);
  const listeners = new Set<GroupListener>();
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

  const publishSnapshot = (snapshot: GroupSnapshot): GroupSnapshot => {
    const nextInviteIds = new Set(snapshot.invites.map((invite) => invite.inviteId));
    for (const invite of snapshot.invites) {
      if (seenInviteIds.has(invite.inviteId)) continue;
      gameStore.addNotification({
        code: 'GROUP_INVITE_RECEIVED',
        message: isPolishUi()
          ? `${invite.inviterName} zaprasza cię do grupy.`
          : `${invite.inviterName} invited you to a group.`,
      });
    }
    seenInviteIds = nextInviteIds;
    groupStore.setSnapshot(snapshot);
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };

  const command = (
    emit: (socket: GameSocket, ack: (response: SocketAck<GroupSnapshot>) => void) => void,
  ): Promise<GroupSnapshot> =>
    withAck<GroupSnapshot>((ack) => emit(requireSocket(), ack)).then(publishSnapshot);

  const bind = (): void => {
    const socket = bridge.socket;
    if (!socket || socket === boundSocket) return;
    boundSocket = socket;
    socket.on('group:updated', publishSnapshot);
  };

  bridge.connect = () => {
    originalConnect();
    bind();
  };
  bridge.disconnect = () => {
    boundSocket = undefined;
    seenInviteIds = new Set();
    listeners.clear();
    groupStore.reset();
    originalDisconnect();
  };

  client.subscribeGroup = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  client.getGroup = () =>
    command((socket, ack) =>
      socket.emit('group:get', { requestId: createRequestId('group') }, ack),
    );
  client.inviteToGroup = (targetCharacterId) =>
    command((socket, ack) =>
      socket.emit(
        'group:invite',
        { requestId: createRequestId('group-invite'), targetCharacterId },
        ack,
      ),
    );
  client.respondGroupInvite = (inviteId, accept) =>
    command((socket, ack) =>
      socket.emit(
        'group:respond',
        { requestId: createRequestId('group-respond'), inviteId, accept },
        ack,
      ),
    );
  client.leaveGroup = () =>
    command((socket, ack) =>
      socket.emit('group:leave', { requestId: createRequestId('group-leave') }, ack),
    );
}
