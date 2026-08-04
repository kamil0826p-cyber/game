import type { Socket } from 'socket.io-client';
import type {
  RewardClaimMutationResult,
  RewardClaimsSnapshot,
} from '../../contracts/rewardClaims';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAck,
} from '../../contracts/socket';
import { publishRewardClaimsUpdated } from '../rewards/rewardClaimsUiEvents';
import { gameStore } from '../state/gameStore';
import { createRequestId } from '../../utils/requestId';
import type { GameSocketClient } from './GameSocketClient';

interface RewardClaimsClientEvents {
  'claims:get': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<RewardClaimsSnapshot>) => void,
  ) => void;
  'claims:claim': (
    payload: { requestId: string; claimId: string },
    acknowledgement: (response: SocketAck<RewardClaimMutationResult>) => void,
  ) => void;
  'claims:claimAll': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<RewardClaimMutationResult>) => void,
  ) => void;
}

type RewardClaimsSocket = Socket<
  ServerToClientEvents,
  Omit<ClientToServerEvents, keyof RewardClaimsClientEvents> & RewardClaimsClientEvents
>;

interface BridgeClient {
  socket?: RewardClaimsSocket;
}

declare module './GameSocketClient' {
  interface GameSocketClient {
    getRewardClaims(): Promise<RewardClaimsSnapshot>;
    claimReward(claimId: string): Promise<RewardClaimMutationResult>;
    claimAllRewards(): Promise<RewardClaimMutationResult>;
  }
}

const ACK_TIMEOUT_MS = 8_000;

export function installRewardClaimsSocketBridge(client: GameSocketClient): void {
  const bridge = client as unknown as BridgeClient;

  const withAck = <T>(
    emit: (
      socket: RewardClaimsSocket,
      acknowledgement: (response: SocketAck<T>) => void,
    ) => void,
  ): Promise<T> =>
    new Promise<SocketAck<T>>((resolve, reject) => {
      const socket = bridge.socket;
      if (!socket?.connected) {
        reject(new Error('The game socket is not connected.'));
        return;
      }
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

  const synchronizeSnapshot = (snapshot: RewardClaimsSnapshot): RewardClaimsSnapshot => {
    publishRewardClaimsUpdated(
      snapshot.summary.totalClaims,
      snapshot.summary.expiringSoonCount,
    );
    return snapshot;
  };

  const synchronizeMutation = async (
    result: RewardClaimMutationResult,
  ): Promise<RewardClaimMutationResult> => {
    synchronizeSnapshot(result.snapshot);
    await client.getInventory();
    return result;
  };

  client.getRewardClaims = () =>
    withAck<RewardClaimsSnapshot>((socket, acknowledgement) =>
      socket.emit(
        'claims:get',
        { requestId: createRequestId('claims-get') },
        acknowledgement,
      ),
    ).then(synchronizeSnapshot);

  client.claimReward = (claimId) =>
    withAck<RewardClaimMutationResult>((socket, acknowledgement) =>
      socket.emit(
        'claims:claim',
        { requestId: createRequestId('claims-claim'), claimId },
        acknowledgement,
      ),
    ).then(synchronizeMutation);

  client.claimAllRewards = () =>
    withAck<RewardClaimMutationResult>((socket, acknowledgement) =>
      socket.emit(
        'claims:claimAll',
        { requestId: createRequestId('claims-claim-all') },
        acknowledgement,
      ),
    ).then(synchronizeMutation);
}
