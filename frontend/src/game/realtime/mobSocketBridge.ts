import type { Socket } from 'socket.io-client';
import type { MobRewardPayload, MobStatePayload } from '../../contracts/mob';
import type {
  ClientToServerEvents,
  CombatSnapshot,
  ServerToClientEvents,
  SocketAck,
} from '../../contracts/socket';
import { createRequestId } from '../../utils/requestId';
import { gameStore } from '../state/gameStore';
import { mobStore } from '../state/mobStore';
import type { GameSocketClient } from './GameSocketClient';

type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
interface BridgeClient {
  socket?: GameSocket;
  connect(): void;
  disconnect(): void;
}

declare module './GameSocketClient' {
  interface GameSocketClient {
    requestMobCombat(mobId: string): Promise<CombatSnapshot>;
  }
}

export const MOB_REWARD_EVENT = 'game:mob-reward';
const ACK_TIMEOUT_MS = 8_000;

export function installMobSocketBridge(client: GameSocketClient): void {
  const bridge = client as unknown as BridgeClient;
  const originalConnect = client.connect.bind(client);
  const originalDisconnect = client.disconnect.bind(client);
  const originalGetActiveCombat = client.getActiveCombat.bind(client);
  const originalPerformCombatAction = client.performCombatAction.bind(client);
  const originalLeaveCombat = client.leaveCombat.bind(client);
  const pveCombatIds = new Set<string>();
  let boundSocket: GameSocket | undefined;

  const withAck = <T>(emit: (ack: (response: SocketAck<T>) => void) => void): Promise<T> =>
    new Promise<SocketAck<T>>((resolve, reject) => {
      const timeout = window.setTimeout(
        () => reject(new Error('The game server did not acknowledge the request.')),
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

  const requestMobs = async (): Promise<void> => {
    const socket = bridge.socket;
    if (!socket?.connected) return;
    const result = await withAck<{ mapId: string; mobs: MobStatePayload[] }>((ack) =>
      socket.emit('mobs:get', { requestId: createRequestId('mobs') }, ack),
    );
    mobStore.replace(result.mapId, result.mobs);
  };

  const applyReward = (reward: MobRewardPayload): void => {
    const internal = gameStore as unknown as {
      patch(patch: { self: MobRewardPayload['self'] }): void;
    };
    internal.patch({ self: reward.self });
    window.dispatchEvent(new CustomEvent<MobRewardPayload>(MOB_REWARD_EVENT, { detail: reward }));
    void client.getSkills().catch(() => undefined);
  };

  const bind = (): void => {
    const socket = bridge.socket;
    if (!socket || socket === boundSocket) return;
    boundSocket = socket;
    socket.on('world:spawn', () => void requestMobs().catch(() => undefined));
    socket.on('world:mapChanged', () => {
      mobStore.clear();
      void requestMobs().catch(() => undefined);
    });
    socket.on('world:mobSpawned', (mob) => mobStore.upsert(mob));
    socket.on('world:mobDespawned', ({ mobId }) => mobStore.remove(mobId));
    socket.on('mob:rewards', applyReward);
    socket.on('combat:updated', (combat) => {
      if (combat.participants.some((participant) => participant.kind === 'MOB')) {
        pveCombatIds.add(combat.combatId);
      }
      if (combat.status === 'FINISHED' || combat.status === 'CANCELLED') {
        window.setTimeout(() => pveCombatIds.delete(combat.combatId), 15_000);
      }
    });
  };

  bridge.connect = () => {
    originalConnect();
    bind();
  };
  bridge.disconnect = () => {
    boundSocket = undefined;
    pveCombatIds.clear();
    mobStore.clear();
    originalDisconnect();
  };

  client.requestMobCombat = async (mobId: string): Promise<CombatSnapshot> => {
    const socket = bridge.socket;
    if (!socket?.connected) throw new Error('The game socket is not connected.');
    const combat = await withAck<CombatSnapshot>((ack) =>
      socket.emit(
        'pve:request',
        { requestId: createRequestId('pve-request'), mobId },
        ack,
      ),
    );
    pveCombatIds.add(combat.combatId);
    gameStore.updateCombatState(combat);
    return combat;
  };

  client.getActiveCombat = async (): Promise<CombatSnapshot | null> => {
    const socket = bridge.socket;
    if (socket?.connected) {
      const pve = await withAck<CombatSnapshot | null>((ack) =>
        socket.emit('pve:getActive', { requestId: createRequestId('pve-active') }, ack),
      );
      if (pve) {
        pveCombatIds.add(pve.combatId);
        gameStore.updateCombatState(pve);
        return pve;
      }
    }
    return originalGetActiveCombat();
  };

  client.performCombatAction = async (
    combatId: string,
    action: 'BASIC_ATTACK' | 'SKILL',
    skillKey?: string,
  ): Promise<CombatSnapshot> => {
    if (!pveCombatIds.has(combatId)) {
      return originalPerformCombatAction(combatId, action, skillKey);
    }
    const socket = bridge.socket;
    if (!socket?.connected) throw new Error('The game socket is not connected.');
    const combat = await withAck<CombatSnapshot>((ack) => {
      if (action === 'SKILL' && skillKey) {
        socket.emit(
          'pve:act',
          { requestId: createRequestId('pve-skill'), combatId, action, skillKey },
          ack,
        );
      } else {
        socket.emit(
          'pve:act',
          { requestId: createRequestId('pve-attack'), combatId, action: 'BASIC_ATTACK' },
          ack,
        );
      }
    });
    gameStore.updateCombatState(combat);
    return combat;
  };

  client.leaveCombat = async (combatId: string): Promise<CombatSnapshot> => {
    if (!pveCombatIds.has(combatId)) return originalLeaveCombat(combatId);
    const socket = bridge.socket;
    if (!socket?.connected) throw new Error('The game socket is not connected.');
    const combat = await withAck<CombatSnapshot>((ack) =>
      socket.emit(
        'pve:leave',
        { requestId: createRequestId('pve-leave'), combatId },
        ack,
      ),
    );
    gameStore.updateCombatState(combat);
    return combat;
  };
}
