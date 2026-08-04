import type { Socket } from 'socket.io-client';
import type { MarketMutationResult, MarketSnapshot } from '../../contracts/market';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAck,
} from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';
import type { GameSocketClient } from './GameSocketClient';

interface MarketClientEvents {
  'market:get': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<MarketSnapshot>) => void,
  ) => void;
  'market:list': (
    payload: { requestId: string; itemId: string; quantity: number; priceSilver: number },
    acknowledgement: (response: SocketAck<MarketMutationResult>) => void,
  ) => void;
  'market:buy': (
    payload: { requestId: string; listingId: string },
    acknowledgement: (response: SocketAck<MarketMutationResult>) => void,
  ) => void;
  'market:cancel': (
    payload: { requestId: string; listingId: string },
    acknowledgement: (response: SocketAck<MarketMutationResult>) => void,
  ) => void;
  'market:close': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<{ closed: boolean }>) => void,
  ) => void;
}

type MarketSocket = Socket<
  ServerToClientEvents,
  Omit<ClientToServerEvents, keyof MarketClientEvents> & MarketClientEvents
>;

interface BridgeClient {
  socket?: MarketSocket;
}

declare module './GameSocketClient' {
  interface GameSocketClient {
    getMarket(): Promise<MarketSnapshot>;
    listMarketItem(
      itemId: string,
      quantity: number,
      priceSilver: number,
    ): Promise<MarketMutationResult>;
    buyMarketListing(listingId: string): Promise<MarketMutationResult>;
    cancelMarketListing(listingId: string): Promise<MarketMutationResult>;
    closeMarket(): Promise<void>;
  }
}

const ACK_TIMEOUT_MS = 8_000;

export function installMarketSocketBridge(client: GameSocketClient): void {
  const bridge = client as unknown as BridgeClient;

  const requireSocket = (): MarketSocket => {
    const socket = bridge.socket;
    if (!socket?.connected) throw new Error('The game socket is not connected.');
    return socket;
  };

  const withAck = <T>(
    emit: (socket: MarketSocket, acknowledgement: (response: SocketAck<T>) => void) => void,
  ): Promise<T> =>
    new Promise<SocketAck<T>>((resolve, reject) => {
      const socket = requireSocket();
      const timeout = window.setTimeout(
        () => reject(new Error('The game server did not acknowledge the request.')),
        ACK_TIMEOUT_MS,
      );
      emit(socket, (response) => {
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

  const synchronizeSilver = (snapshot: MarketSnapshot): MarketSnapshot => {
    const self = gameStore.getSnapshot().self;
    if (self && self.silver !== snapshot.silver) {
      gameStore.updateCurrency({
        characterId: self.characterId,
        currency: 'SILVER',
        amount: snapshot.silver - self.silver,
        balance: snapshot.silver,
      });
    }
    return snapshot;
  };

  const synchronizeResult = (result: MarketMutationResult): MarketMutationResult => {
    synchronizeSilver(result.snapshot);
    return result;
  };

  const refreshInventory = async <T>(result: T): Promise<T> => {
    await client.getInventory();
    return result;
  };

  client.getMarket = () =>
    withAck<MarketSnapshot>((socket, acknowledgement) =>
      socket.emit('market:get', { requestId: createRequestId('market-get') }, acknowledgement),
    ).then(synchronizeSilver);

  client.listMarketItem = (itemId, quantity, priceSilver) =>
    withAck<MarketMutationResult>((socket, acknowledgement) =>
      socket.emit(
        'market:list',
        {
          requestId: createRequestId('market-list'),
          itemId,
          quantity,
          priceSilver,
        },
        acknowledgement,
      ),
    )
      .then(synchronizeResult)
      .then(refreshInventory);

  client.buyMarketListing = (listingId) =>
    withAck<MarketMutationResult>((socket, acknowledgement) =>
      socket.emit(
        'market:buy',
        { requestId: createRequestId('market-buy'), listingId },
        acknowledgement,
      ),
    )
      .then(synchronizeResult)
      .then(refreshInventory);

  client.cancelMarketListing = (listingId) =>
    withAck<MarketMutationResult>((socket, acknowledgement) =>
      socket.emit(
        'market:cancel',
        { requestId: createRequestId('market-cancel'), listingId },
        acknowledgement,
      ),
    )
      .then(synchronizeResult)
      .then(refreshInventory);

  client.closeMarket = async () => {
    const socket = bridge.socket;
    if (!socket?.connected) return;
    await withAck<{ closed: boolean }>((activeSocket, acknowledgement) =>
      activeSocket.emit(
        'market:close',
        { requestId: createRequestId('market-close') },
        acknowledgement,
      ),
    )
      .then(() => undefined)
      .catch(() => undefined);
  };
}
