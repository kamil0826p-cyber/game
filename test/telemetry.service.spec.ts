import { describe, expect, it, vi } from 'vitest';
import type { GameConfigService } from '../src/config/game-config.service.js';
import { TelemetryService } from '../src/telemetry/telemetry.service.js';
import type { TelemetrySink } from '../src/telemetry/telemetry.sink.js';

const config = (overrides: Record<string, unknown> = {}): GameConfigService =>
  ({
    values: {
      TELEMETRY_ENABLED: true,
      TELEMETRY_BATCH_SIZE: 2,
      TELEMETRY_MAX_QUEUE: 3,
      TELEMETRY_FLUSH_MS: 60_000,
      TELEMETRY_SHUTDOWN_TIMEOUT_MS: 50,
      ...overrides,
    },
  }) as unknown as GameConfigService;

describe('TelemetryService', () => {
  it('validates event payloads before queueing', () => {
    const sink: TelemetrySink = { send: vi.fn().mockResolvedValue(undefined) };
    const service = new TelemetryService(config(), sink);

    expect(
      service.emit('character_created', { characterId: 'character-1' }, { characterClass: 'MAGE' }),
    ).toBe(true);
    expect(
      service.emit('character_created', { characterId: 'character-1' }, { characterClass: 'INVALID' }),
    ).toBe(false);
    expect(service.getStats().queued).toBe(1);
  });

  it('flushes in bounded batches without blocking emit', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const service = new TelemetryService(config(), { send });
    service.emit('world_entered', { characterId: 'character-1' }, { mapId: 'map-1' });
    service.emit('world_entered', { characterId: 'character-2' }, { mapId: 'map-1' });
    service.emit('world_entered', { characterId: 'character-3' }, { mapId: 'map-1' });

    await service.flush();
    expect(send).toHaveBeenCalled();
    expect(service.getStats().sent).toBeGreaterThan(0);
    expect(service.getStats().queued).toBeLessThan(3);
  });

  it('requeues a failed batch within the configured capacity', async () => {
    const send = vi.fn().mockRejectedValue(new Error('down'));
    const service = new TelemetryService(config({ TELEMETRY_BATCH_SIZE: 3 }), { send });
    service.emit('world_entered', { characterId: 'character-1' }, { mapId: 'map-1' });
    service.emit('world_entered', { characterId: 'character-2' }, { mapId: 'map-1' });

    await expect(service.flush()).rejects.toThrow('down');
    expect(service.getStats()).toMatchObject({ queued: 2, failures: 1, dropped: 0 });
  });

  it('drops the oldest event when the queue is full', () => {
    const service = new TelemetryService(config({ TELEMETRY_BATCH_SIZE: 10 }), {
      send: vi.fn().mockResolvedValue(undefined),
    });
    for (let index = 0; index < 5; index += 1) {
      service.emit(
        'world_entered',
        { characterId: `character-${index}` },
        { mapId: 'map-1' },
      );
    }
    expect(service.getStats()).toMatchObject({ queued: 3, dropped: 2 });
  });
});
