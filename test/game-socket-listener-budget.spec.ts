import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  GAME_SOCKET_LISTENER_BUDGET,
  configureGameSocketListenerBudget,
} from '../src/common/socket/game-socket-listener-budget.js';

describe('game socket listener budget', () => {
  it('raises the default EventEmitter limit for the shared game socket', () => {
    const socket = new EventEmitter();

    configureGameSocketListenerBudget(socket);

    expect(socket.getMaxListeners()).toBe(GAME_SOCKET_LISTENER_BUDGET);
  });

  it('does not replace an unlimited or already higher limit', () => {
    const unlimited = new EventEmitter();
    unlimited.setMaxListeners(0);
    configureGameSocketListenerBudget(unlimited);
    expect(unlimited.getMaxListeners()).toBe(0);

    const higher = new EventEmitter();
    higher.setMaxListeners(GAME_SOCKET_LISTENER_BUDGET + 10);
    configureGameSocketListenerBudget(higher);
    expect(higher.getMaxListeners()).toBe(GAME_SOCKET_LISTENER_BUDGET + 10);
  });
});
