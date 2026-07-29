import type { Socket } from 'socket.io-client';
import type { CharacterClass } from '../../contracts/game';
import type { SocketAck, SocketErrorPayload, WorldSpawnPayload } from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';
import type { GameSocketClient } from './GameSocketClient';

export interface CharacterLobbySummary {
  id: string;
  name: string;
  characterClass: CharacterClass;
  level: number;
  outfitKey: string;
  mapId: string;
  lastSavedAt: number;
}

type LobbySocket = Socket & {
  emit(event: 'character:list', payload: { requestId: string }, ack: (response: SocketAck<CharacterLobbySummary[]>) => void): void;
  emit(event: 'character:select', payload: { requestId: string; characterId: string }, ack: (response: SocketAck<WorldSpawnPayload>) => void): void;
  emit(event: 'character:outfit', payload: { requestId: string; characterId: string; outfitKey: string }, ack: (response: SocketAck<WorldSpawnPayload>) => void): void;
};

const socketFor = (client: GameSocketClient): LobbySocket => {
  const socket = (client as unknown as { socket?: LobbySocket }).socket;
  if (!socket?.connected) throw new Error('Game socket is not connected.');
  return socket;
};

const command = <T>(emit: (socket: LobbySocket, ack: (response: SocketAck<T>) => void) => void): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Server acknowledgement timed out.')), 8_000);
    const ack = (response: SocketAck<T>) => {
      window.clearTimeout(timeout);
      if (!response.ok) {
        gameStore.addNotification(response.error as SocketErrorPayload);
        reject(new Error(response.error.message));
        return;
      }
      resolve(response.data);
    };
    try {
      emit(socketFor(currentClient!), ack);
    } catch (error) {
      window.clearTimeout(timeout);
      reject(error);
    }
  });

let currentClient: GameSocketClient | undefined;
const run = async <T>(client: GameSocketClient, emit: (socket: LobbySocket, ack: (response: SocketAck<T>) => void) => void): Promise<T> => {
  currentClient = client;
  try {
    return await command(emit);
  } finally {
    currentClient = undefined;
  }
};

export const listCharacters = (client: GameSocketClient): Promise<CharacterLobbySummary[]> =>
  run(client, (socket, ack) => socket.emit('character:list', { requestId: createRequestId('character-list') }, ack));

export const selectCharacter = async (client: GameSocketClient, characterId: string): Promise<WorldSpawnPayload> => {
  const spawn = await run(client, (socket, ack) => socket.emit('character:select', { requestId: createRequestId('character-select'), characterId }, ack));
  gameStore.spawn(spawn);
  return spawn;
};

export const changeCharacterOutfit = async (client: GameSocketClient, characterId: string, outfitKey: string): Promise<WorldSpawnPayload> => {
  const spawn = await run(client, (socket, ack) => socket.emit('character:outfit', { requestId: createRequestId('character-outfit'), characterId, outfitKey }, ack));
  gameStore.spawn(spawn);
  return spawn;
};
