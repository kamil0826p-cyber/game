import type { ProgressionNodeKey, ProgressionSnapshot } from '../../contracts/progression';
import { createRequestId } from '../../utils/requestId';
import type { GameSocketClient } from './GameSocketClient';

interface ProgressionSocket {
  emit(
    event: 'progression:get' | 'progression:choose' | 'progression:respec',
    payload: Record<string, unknown>,
    acknowledgement: (response: ProgressionResponse) => void,
  ): void;
}

type ProgressionResponse =
  | { ok: true; data: ProgressionSnapshot }
  | { ok: false; error: { code: string; message: string } };

function socket(client: GameSocketClient): ProgressionSocket {
  return (client as unknown as { requireSocket(): ProgressionSocket }).requireSocket();
}

function command(
  client: GameSocketClient,
  event: 'progression:get' | 'progression:choose' | 'progression:respec',
  payload: Record<string, unknown>,
): Promise<ProgressionSnapshot> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('The game server did not acknowledge the progression request.')), 8_000);
    socket(client).emit(event, payload, (response) => {
      window.clearTimeout(timeout);
      if (response.ok) resolve(response.data);
      else reject(new Error(response.error.message));
    });
  });
}

export function getProgression(client: GameSocketClient): Promise<ProgressionSnapshot> {
  return command(client, 'progression:get', { requestId: createRequestId('progression') });
}

export function chooseProgression(
  client: GameSocketClient,
  nodeKey: ProgressionNodeKey,
): Promise<ProgressionSnapshot> {
  return command(client, 'progression:choose', {
    requestId: createRequestId('progression-choice'),
    nodeKey,
  });
}

export function respecProgression(client: GameSocketClient): Promise<ProgressionSnapshot> {
  return command(client, 'progression:respec', { requestId: createRequestId('progression-respec') });
}
