import type { CharacterClass } from '../../contracts/game';
import type { SocketAck, WorldSpawnPayload } from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';
import { GameSocketClient } from './GameSocketClient';

export interface CharacterRosterEntry {
  characterId: string;
  name: string;
  characterClass: CharacterClass;
  level: number;
  experience: number;
  outfitKey: string;
  mapId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
}

export interface CharacterRosterPayload {
  characters: CharacterRosterEntry[];
  maxCharacters: number;
}

type InternalClient = {
  requireSocket(): { emit(event: string, ...args: unknown[]): void };
  withAck<T>(emit: (ack: (response: SocketAck<T>) => void) => void): Promise<SocketAck<T>>;
  assertOk<T>(response: SocketAck<T>): asserts response is { ok: true; data: T };
};

declare module './GameSocketClient' {
  interface GameSocketClient {
    listCharacters(): Promise<CharacterRosterPayload>;
    selectCharacter(characterId: string): Promise<void>;
    updateCharacterOutfit(characterId: string, outfitKey: string): Promise<CharacterRosterEntry>;
    createCharacterWithOutfit(name: string, characterClass: CharacterClass, outfitKey: string): Promise<void>;
  }
}

GameSocketClient.prototype.listCharacters = async function (): Promise<CharacterRosterPayload> {
  const internal = this as unknown as InternalClient;
  const response = await internal.withAck<CharacterRosterPayload>((ack) =>
    internal.requireSocket().emit('character:list', ack),
  );
  internal.assertOk(response);
  return response.data;
};

GameSocketClient.prototype.selectCharacter = async function (characterId: string): Promise<void> {
  const internal = this as unknown as InternalClient;
  const response = await internal.withAck<WorldSpawnPayload>((ack) =>
    internal.requireSocket().emit(
      'character:select',
      { requestId: createRequestId('character-select'), characterId },
      ack,
    ),
  );
  internal.assertOk(response);
  gameStore.spawn(response.data);
};

GameSocketClient.prototype.updateCharacterOutfit = async function (
  characterId: string,
  outfitKey: string,
): Promise<CharacterRosterEntry> {
  const internal = this as unknown as InternalClient;
  const response = await internal.withAck<CharacterRosterEntry>((ack) =>
    internal.requireSocket().emit(
      'character:outfit',
      { requestId: createRequestId('character-outfit'), characterId, outfitKey },
      ack,
    ),
  );
  internal.assertOk(response);
  return response.data;
};

GameSocketClient.prototype.createCharacterWithOutfit = async function (
  name: string,
  characterClass: CharacterClass,
  outfitKey: string,
): Promise<void> {
  await this.createCharacter(name, characterClass);
  const characterId = gameStore.getSnapshot().self?.characterId;
  if (characterId) await this.updateCharacterOutfit(characterId, outfitKey);
};
