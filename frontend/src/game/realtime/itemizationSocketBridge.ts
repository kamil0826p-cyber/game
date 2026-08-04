import type { Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  InventorySnapshot,
  ServerToClientEvents,
  SocketAck,
} from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';
import type { GameSocketClient } from './GameSocketClient';

interface ItemEconomySnapshot {
  silver: number;
  recipes: unknown[];
  claims: unknown[];
  craftOrders: unknown[];
  listings: unknown[];
}

interface ItemizationClientEvents {
  'inventory:equip': (
    payload: {
      requestId: string;
      itemId: string;
      confirmationHash?: string;
    },
    acknowledgement: (response: SocketAck<InventorySnapshot>) => void,
  ) => void;
  'itemization:salvage': (
    payload: {
      requestId: string;
      itemId: string;
    },
    acknowledgement: (response: SocketAck<ItemEconomySnapshot>) => void,
  ) => void;
}

type ItemizationSocket = Socket<
  ServerToClientEvents,
  Omit<ClientToServerEvents, 'inventory:equip'> & ItemizationClientEvents
>;

interface BridgeClient {
  socket?: ItemizationSocket;
}

declare module './GameSocketClient' {
  interface GameSocketClient {
    equipInventoryItem(
      itemId: string,
      confirmationHash?: string,
    ): Promise<InventorySnapshot>;
    salvageInventoryItem(itemId: string): Promise<InventorySnapshot>;
  }
}

const ACK_TIMEOUT_MS = 8_000;

export function installItemizationSocketBridge(client: GameSocketClient): void {
  const bridge = client as unknown as BridgeClient;

  client.equipInventoryItem = (itemId, confirmationHash) =>
    new Promise<SocketAck<InventorySnapshot>>((resolve, reject) => {
      const socket = bridge.socket;
      if (!socket?.connected) {
        reject(new Error('The game socket is not connected.'));
        return;
      }
      const timeout = window.setTimeout(
        () => reject(new Error('The game server did not acknowledge the request.')),
        ACK_TIMEOUT_MS,
      );
      socket.emit(
        'inventory:equip',
        {
          requestId: createRequestId('inventory-equip'),
          itemId,
          ...(confirmationHash ? { confirmationHash } : {}),
        },
        (response) => {
          window.clearTimeout(timeout);
          resolve(response);
        },
      );
    }).then((response) => {
      if (!response.ok) {
        gameStore.addNotification(response.error);
        throw new Error(response.error.message);
      }
      gameStore.updateInventoryState(response.data);
      return response.data;
    });

  client.salvageInventoryItem = (itemId) =>
    new Promise<SocketAck<ItemEconomySnapshot>>((resolve, reject) => {
      const socket = bridge.socket;
      if (!socket?.connected) {
        reject(new Error('The game socket is not connected.'));
        return;
      }
      const timeout = window.setTimeout(
        () => reject(new Error('The game server did not acknowledge the request.')),
        ACK_TIMEOUT_MS,
      );
      socket.emit(
        'itemization:salvage',
        {
          requestId: createRequestId('item-salvage'),
          itemId,
        },
        (response) => {
          window.clearTimeout(timeout);
          resolve(response);
        },
      );
    }).then(async (response) => {
      if (!response.ok) {
        gameStore.addNotification(response.error);
        throw new Error(response.error.message);
      }
      return client.getInventory();
    });
}
