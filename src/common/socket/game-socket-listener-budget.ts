export const GAME_SOCKET_LISTENER_BUDGET = 32;

interface ListenerBudgetTarget {
  getMaxListeners(): number;
  setMaxListeners(maxListeners: number): unknown;
}

export function configureGameSocketListenerBudget(target: ListenerBudgetTarget): void {
  const currentLimit = target.getMaxListeners();
  if (currentLimit !== 0 && currentLimit < GAME_SOCKET_LISTENER_BUDGET) {
    target.setMaxListeners(GAME_SOCKET_LISTENER_BUDGET);
  }
}
