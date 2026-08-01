import type { Socket } from 'socket.io-client';
import type {
  CharacterProgressionSnapshot,
  MilestoneKey,
} from '../../contracts/progression';
import type { SocketAck } from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';
import type { GameSocketClient } from './GameSocketClient';

interface ProgressionClientEvents {
  'progression:get': (
    payload: { requestId: string },
    acknowledgement: (response: SocketAck<CharacterProgressionSnapshot>) => void,
  ) => void;
  'progression:allocate': (
    payload: { requestId: string; milestoneKey: MilestoneKey },
    acknowledgement: (response: SocketAck<CharacterProgressionSnapshot>) => void,
  ) => void;
  'progression:respec': (
    payload: {
      requestId: string;
      operationId: string;
      milestones: Array<{ key: MilestoneKey; rank: number }>;
    },
    acknowledgement: (response: SocketAck<CharacterProgressionSnapshot>) => void,
  ) => void;
}

type ProgressionSocket = Socket<Record<string, never>, ProgressionClientEvents>;
interface BridgeClient {
  socket?: ProgressionSocket;
}

declare module './GameSocketClient' {
  interface GameSocketClient {
    getCharacterProgression(): Promise<CharacterProgressionSnapshot>;
    allocateCharacterMilestone(milestoneKey: MilestoneKey): Promise<CharacterProgressionSnapshot>;
    respecCharacterMilestones(
      milestones?: Array<{ key: MilestoneKey; rank: number }>,
    ): Promise<CharacterProgressionSnapshot>;
  }
}

const ACK_TIMEOUT_MS = 8_000;

export function installCharacterProgressionSocketBridge(client: GameSocketClient): void {
  const bridge = client as unknown as BridgeClient;

  const requireSocket = (): ProgressionSocket => {
    const socket = bridge.socket;
    if (!socket?.connected) throw new Error('The game socket is not connected.');
    return socket;
  };

  const command = (
    emit: (
      socket: ProgressionSocket,
      acknowledgement: (response: SocketAck<CharacterProgressionSnapshot>) => void,
    ) => void,
  ): Promise<CharacterProgressionSnapshot> =>
    new Promise<SocketAck<CharacterProgressionSnapshot>>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('The game server did not acknowledge the request.')),
        ACK_TIMEOUT_MS,
      );
      emit(requireSocket(), (response) => {
        window.clearTimeout(timeout);
        resolve(response);
      });
    }).then((response) => {
      if (!response.ok) {
        gameStore.addNotification(response.error);
        throw new Error(response.error.message);
      }
      const snapshot = response.data;
      gameStore.updateInventoryState({
        capacity: 0,
        silver: snapshot.current.silver,
        items: [],
        character: {
          hp: snapshot.current.hp,
          maxHp: snapshot.effective.maxHp,
          energy: snapshot.current.energy,
          maxEnergy: snapshot.effective.maxEnergy,
          strength: snapshot.effective.strength,
          agility: snapshot.effective.agility,
          intelligence: snapshot.effective.intelligence,
          armor: snapshot.effective.armor,
          silver: snapshot.current.silver,
        },
      });
      return snapshot;
    });

  client.getCharacterProgression = () =>
    command((socket, acknowledgement) =>
      socket.emit(
        'progression:get',
        { requestId: createRequestId('progression') },
        acknowledgement,
      ),
    );

  client.allocateCharacterMilestone = (milestoneKey) =>
    command((socket, acknowledgement) =>
      socket.emit(
        'progression:allocate',
        { requestId: createRequestId('progression-allocate'), milestoneKey },
        acknowledgement,
      ),
    );

  client.respecCharacterMilestones = (milestones = []) =>
    command((socket, acknowledgement) =>
      socket.emit(
        'progression:respec',
        {
          requestId: createRequestId('progression-respec-request'),
          operationId: createRequestId('progression-respec-operation'),
          milestones,
        },
        acknowledgement,
      ),
    );
}
