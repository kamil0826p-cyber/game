import type { Socket } from 'socket.io-client';
import type {
  ExpeditionCatalogView,
  ExpeditionClientToServerEvents,
  ExpeditionMutationPayload,
  ExpeditionPreparePayload,
  ExpeditionPublicView,
  ExpeditionServerToClientEvents,
} from '../../contracts/expedition';
import type { SocketAck } from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';
import type { GameSocketClient } from './GameSocketClient';

type GameSocket = Socket<ExpeditionServerToClientEvents, ExpeditionClientToServerEvents>;
type ExpeditionListener = (snapshot: ExpeditionPublicView) => void;
interface BridgeClient {
  socket?: GameSocket;
  connect(): void;
  disconnect(): void;
}

declare module './GameSocketClient' {
  interface GameSocketClient {
    subscribeExpedition(listener: ExpeditionListener): () => void;
    getExpeditionCatalog(): Promise<ExpeditionCatalogView[]>;
    getExpedition(): Promise<ExpeditionPublicView | null>;
    prepareExpedition(payload: Omit<ExpeditionPreparePayload, 'operationId'>): Promise<ExpeditionPublicView>;
    startExpedition(payload: Omit<ExpeditionMutationPayload, 'operationId'>): Promise<ExpeditionPublicView>;
    advanceExpedition(payload: Omit<ExpeditionMutationPayload, 'operationId'> & { edgeKey: string }): Promise<ExpeditionPublicView>;
    selectExpeditionRitual(payload: Omit<ExpeditionMutationPayload, 'operationId'> & { choiceKey: string }): Promise<ExpeditionPublicView>;
    extractExpedition(payload: Omit<ExpeditionMutationPayload, 'operationId'>): Promise<ExpeditionPublicView>;
    abandonExpedition(payload: Omit<ExpeditionMutationPayload, 'operationId'>): Promise<ExpeditionPublicView>;
  }
}

const ACK_TIMEOUT_MS = 8_000;

export function installExpeditionSocketBridge(client: GameSocketClient): void {
  const bridge = client as unknown as BridgeClient;
  const originalConnect = client.connect.bind(client);
  const originalDisconnect = client.disconnect.bind(client);
  const listeners = new Set<ExpeditionListener>();
  let boundSocket: GameSocket | undefined;

  const requireSocket = (): GameSocket => {
    const socket = bridge.socket;
    if (!socket?.connected) throw new Error('The game socket is not connected.');
    return socket;
  };

  const withAck = <T>(emit: (ack: (response: SocketAck<T>) => void) => void): Promise<T> =>
    new Promise<SocketAck<T>>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('The game server did not acknowledge the expedition request.')),
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

  const publish = (snapshot: ExpeditionPublicView): ExpeditionPublicView => {
    for (const listener of listeners) listener(snapshot);
    return snapshot;
  };

  const bind = (): void => {
    const socket = bridge.socket;
    if (!socket || socket === boundSocket) return;
    boundSocket = socket;
    socket.on('expedition:updated', publish);
  };

  bridge.connect = () => {
    originalConnect();
    bind();
  };
  bridge.disconnect = () => {
    boundSocket = undefined;
    listeners.clear();
    originalDisconnect();
  };

  client.subscribeExpedition = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  client.getExpeditionCatalog = () =>
    withAck<ExpeditionCatalogView[]>((ack) =>
      requireSocket().emit('expedition:catalog', {}, ack),
    );
  client.getExpedition = () =>
    withAck<ExpeditionPublicView | null>((ack) =>
      requireSocket().emit('expedition:get', {}, ack),
    );
  client.prepareExpedition = (payload) =>
    withAck<ExpeditionPublicView>((ack) =>
      requireSocket().emit(
        'expedition:prepare',
        { ...payload, operationId: createRequestId('expedition-prepare') },
        ack,
      ),
    ).then(publish);
  client.startExpedition = (payload) =>
    withAck<ExpeditionPublicView>((ack) =>
      requireSocket().emit(
        'expedition:start',
        { ...payload, operationId: createRequestId('expedition-start') },
        ack,
      ),
    ).then(publish);
  client.advanceExpedition = (payload) =>
    withAck<ExpeditionPublicView>((ack) =>
      requireSocket().emit(
        'expedition:advance',
        { ...payload, operationId: createRequestId('expedition-advance') },
        ack,
      ),
    ).then(publish);
  client.selectExpeditionRitual = (payload) =>
    withAck<ExpeditionPublicView>((ack) =>
      requireSocket().emit(
        'expedition:ritual',
        { ...payload, operationId: createRequestId('expedition-ritual') },
        ack,
      ),
    ).then(publish);
  client.extractExpedition = (payload) =>
    withAck<ExpeditionPublicView>((ack) =>
      requireSocket().emit(
        'expedition:extract',
        { ...payload, operationId: createRequestId('expedition-extract') },
        ack,
      ),
    ).then(publish);
  client.abandonExpedition = (payload) =>
    withAck<ExpeditionPublicView>((ack) =>
      requireSocket().emit(
        'expedition:abandon',
        { ...payload, operationId: createRequestId('expedition-abandon') },
        ack,
      ),
    ).then(publish);
}
