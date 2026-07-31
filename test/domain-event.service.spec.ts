import { describe, expect, it, vi } from 'vitest';
import { appendDomainEvent } from '../src/domain-events/domain-event.service.js';
import type { DomainEventRecord } from '../src/domain-events/domain-event.types.js';

const record: DomainEventRecord = {
  id: '00000000-0000-4000-8000-000000000001',
  deduplicationKey: 'CombatFinished:combat-1',
  operationId: 'combat-1',
  type: 'CombatFinished',
  schemaVersion: 1,
  actorCharacterId: null,
  realmId: null,
  mapId: null,
  regionKey: null,
  payload: {},
  occurredAt: new Date('2026-07-31T00:00:00Z'),
  createdAt: new Date('2026-07-31T00:00:00Z'),
};

describe('appendDomainEvent', () => {
  it('creates an outbox entry with a new event', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([record]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    const result = await appendDomainEvent(tx as never, {
      operationId: 'combat-1', type: 'CombatFinished', payload: {},
    });
    expect(result.created).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
  });

  it('returns the existing event without creating another outbox row', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([record]),
      $executeRaw: vi.fn(),
    };
    const result = await appendDomainEvent(tx as never, {
      operationId: 'combat-1', type: 'CombatFinished', payload: {},
    });
    expect(result.created).toBe(false);
    expect(result.event.id).toBe(record.id);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects malformed contribution amounts before writing', async () => {
    const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
    await expect(appendDomainEvent(tx as never, {
      operationId: 'bad', type: 'CombatFinished',
      payload: { contributions: [{ subjectType: 'CHARACTER', subjectId: 'c', kind: 'COMBAT', amount: 0 }] },
    })).rejects.toThrow('positive integer');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
