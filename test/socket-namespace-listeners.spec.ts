import { describe, expect, it, vi } from 'vitest';
import {
  GAME_SOCKET_NAMESPACE_MAX_LISTENERS,
  configureNamespaceListenerLimit,
} from '../src/auth/game-socket-io.adapter.js';

describe('Socket.IO namespace listener capacity', () => {
  it('raises only a low emitter limit to the bounded game namespace allowance', () => {
    let limit = 10;
    const emitter = {
      getMaxListeners: vi.fn(() => limit),
      setMaxListeners: vi.fn((nextLimit: number) => {
        limit = nextLimit;
        return emitter;
      }),
    };

    configureNamespaceListenerLimit(emitter);

    expect(limit).toBe(GAME_SOCKET_NAMESPACE_MAX_LISTENERS);
    expect(emitter.setMaxListeners).toHaveBeenCalledOnce();
    expect(emitter.setMaxListeners).toHaveBeenCalledWith(GAME_SOCKET_NAMESPACE_MAX_LISTENERS);
  });

  it('does not lower an explicitly larger listener limit', () => {
    const emitter = {
      getMaxListeners: vi.fn(() => 64),
      setMaxListeners: vi.fn(),
    };

    configureNamespaceListenerLimit(emitter);

    expect(emitter.setMaxListeners).not.toHaveBeenCalled();
  });

  it('ignores values that are not EventEmitter-compatible', () => {
    expect(() => configureNamespaceListenerLimit(undefined)).not.toThrow();
    expect(() => configureNamespaceListenerLimit({})).not.toThrow();
  });
});
