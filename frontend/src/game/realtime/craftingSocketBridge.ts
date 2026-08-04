import type { Socket } from 'socket.io-client';
import type {
  CraftOrderMutationResult,
  CraftingResult,
  CraftingSnapshot,
} from '../../contracts/crafting';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAck,
} from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { invalidateRewardClaims } from '../rewards/rewardClaimsUiEvents';
import { gameStore } from '../state/gameStore';
import type { GameSocketClient } from './GameSocketClient';

interface CraftingClientEvents {
  'crafting:get': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<CraftingSnapshot>) => void,
  ) => void;
  'crafting:craft': (
    payload: { requestId: string; recipeKey: string; recipeVersion: number },
    acknowledgement: (response: SocketAck<CraftingResult>) => void,
  ) => void;
  'crafting:orderCreate': (
    payload: { requestId: string; recipeKey: string; rewardSilver: number },
    acknowledgement: (response: SocketAck<CraftOrderMutationResult>) => void,
  ) => void;
  'crafting:orderFulfill': (
    payload: { requestId: string; orderId: string },
    acknowledgement: (response: SocketAck<CraftOrderMutationResult>) => void,
  ) => void;
  'crafting:orderCancel': (
    payload: { requestId: string; orderId: string },
    acknowledgement: (response: SocketAck<CraftOrderMutationResult>) => void,
  ) => void;
  'crafting:close': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<{ closed: boolean }>) => void,
  ) => void;
}

type CraftingSocket = Socket<
  ServerToClientEvents,
  Omit<ClientToServerEvents, keyof CraftingClientEvents> & CraftingClientEvents
>;

interface BridgeClient {
  socket?: CraftingSocket;
}

declare module './GameSocketClient' {
  interface GameSocketClient {
    getCrafting(): Promise<CraftingSnapshot>;
    craftRecipe(recipeKey: string, recipeVersion: number): Promise<CraftingResult>;
    createCraftOrder(
      recipeKey: string,
      rewardSilver: number,
    ): Promise<CraftOrderMutationResult>;
    fulfillCraftOrder(orderId: string): Promise<CraftOrderMutationResult>;
    cancelCraftOrder(orderId: string): Promise<CraftOrderMutationResult>;
    closeCrafting(): Promise<void>;
  }
}

const ACK_TIMEOUT_MS = 8_000;

class CraftingAckTimeoutError extends Error {
  constructor() {
    super('The game server did not acknowledge the request.');
    this.name = 'CraftingAckTimeoutError';
  }
}

export function installCraftingSocketBridge(client: GameSocketClient): void {
  const bridge = client as unknown as BridgeClient;

  const requireSocket = (): CraftingSocket => {
    const socket = bridge.socket;
    if (!socket?.connected) throw new Error('The game socket is not connected.');
    return socket;
  };

  const withAck = <T>(
    emit: (socket: CraftingSocket, acknowledgement: (response: SocketAck<T>) => void) => void,
  ): Promise<T> =>
    new Promise<SocketAck<T>>((resolve, reject) => {
      const socket = requireSocket();
      const timeout = window.setTimeout(
        () => reject(new CraftingAckTimeoutError()),
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

  const synchronizeSilver = (snapshot: CraftingSnapshot): CraftingSnapshot => {
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

  const synchronizeResult = <T extends CraftingResult | CraftOrderMutationResult>(result: T): T => {
    synchronizeSilver(result.snapshot);
    const delivery = 'crafted' in result ? result.crafted.delivery : result.mutation.delivery;
    if (delivery === 'CLAIMS') invalidateRewardClaims();
    return result;
  };

  const refreshInventory = async <T>(result: T): Promise<T> => {
    await client.getInventory().catch(() => undefined);
    return result;
  };

  client.getCrafting = () =>
    withAck<CraftingSnapshot>((socket, acknowledgement) =>
      socket.emit(
        'crafting:get',
        { requestId: createRequestId('crafting-get') },
        acknowledgement,
      ),
    ).then(synchronizeSilver);

  client.craftRecipe = (recipeKey, recipeVersion) => {
    const requestId = createRequestId('crafting-craft');
    const attempt = (): Promise<CraftingResult> =>
      withAck<CraftingResult>((socket, acknowledgement) =>
        socket.emit(
          'crafting:craft',
          { requestId, recipeKey, recipeVersion },
          acknowledgement,
        ),
      );
    return attempt()
      .catch((error: unknown) => {
        if (error instanceof CraftingAckTimeoutError) return attempt();
        throw error;
      })
      .then(synchronizeResult)
      .then(refreshInventory);
  };

  client.createCraftOrder = (recipeKey, rewardSilver) =>
    withAck<CraftOrderMutationResult>((socket, acknowledgement) =>
      socket.emit(
        'crafting:orderCreate',
        {
          requestId: createRequestId('craft-order-create'),
          recipeKey,
          rewardSilver,
        },
        acknowledgement,
      ),
    )
      .then(synchronizeResult)
      .then(refreshInventory);

  client.fulfillCraftOrder = (orderId) =>
    withAck<CraftOrderMutationResult>((socket, acknowledgement) =>
      socket.emit(
        'crafting:orderFulfill',
        { requestId: createRequestId('craft-order-fulfill'), orderId },
        acknowledgement,
      ),
    )
      .then(synchronizeResult)
      .then(refreshInventory);

  client.cancelCraftOrder = (orderId) =>
    withAck<CraftOrderMutationResult>((socket, acknowledgement) =>
      socket.emit(
        'crafting:orderCancel',
        { requestId: createRequestId('craft-order-cancel'), orderId },
        acknowledgement,
      ),
    )
      .then(synchronizeResult)
      .then(refreshInventory);

  client.closeCrafting = async () => {
    const socket = bridge.socket;
    if (!socket?.connected) return;
    await withAck<{ closed: boolean }>((activeSocket, acknowledgement) =>
      activeSocket.emit(
        'crafting:close',
        { requestId: createRequestId('crafting-close') },
        acknowledgement,
      ),
    )
      .then(() => undefined)
      .catch(() => undefined);
  };
}
