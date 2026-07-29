import type { SocketAck } from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import type { GameSocketClient } from '../realtime/GameSocketClient';
import type { QuestLogSnapshot } from './quest.types';

type QuestSocketClient = {
  requireSocket(): { emit(event: string, payload: unknown, acknowledgement: (response: SocketAck<QuestLogSnapshot>) => void): void };
  withAck<T>(operation: (acknowledgement: (response: SocketAck<T>) => void) => void): Promise<SocketAck<T>>;
};

export async function getQuestLog(client: GameSocketClient): Promise<QuestLogSnapshot> {
  const questClient = client as unknown as QuestSocketClient;
  const response = await questClient.withAck<QuestLogSnapshot>((acknowledgement) => {
    questClient.requireSocket().emit('quests:get', { requestId: createRequestId('quests') }, acknowledgement);
  });
  if (!response.ok) throw new Error(response.error.message);
  return response.data;
}
