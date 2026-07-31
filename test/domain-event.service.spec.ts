import { describe, expect, it, vi } from 'vitest';
import { materializeDomainEffects } from '../src/domain-events/domain-event.effects.js';
import { appendDomainEvent, requeueDomainEvents } from '../src/domain-events/domain-event.service.js';
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
  payload: { combatId: 'combat-1', participants: [{ characterId: 'c1' }] },
  occurredAt: new Date('2026-07-31T00:00:00Z'),
  createdAt: new Date('2026-07-31T00:00:00Z'),
};

describe('appendDomainEvent', () => {
  it('creates an outbox entry in the same unit of work', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([record]),
      $executeRaw: vi.fn().mockResolvedValue(1),
    };
    const result = await appendDomainEvent(tx as never, {
      operationId: 'combat-1',
      type: 'CombatFinished',
      payload: { combatId: 'combat-1', participants: [{ characterId: 'c1' }] },
    });
    expect(result.created).toBe(true);
    expect(tx.$executeRaw).toHaveBeenCalledOnce();
  });

  it('returns the existing identical event without a second outbox row', async () => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([record]),
      $executeRaw: vi.fn(),
    };
    const result = await appendDomainEvent(tx as never, {
      operationId: 'combat-1',
      type: 'CombatFinished',
      payload: { combatId: 'combat-1', participants: [{ characterId: 'c1' }] },
    });
    expect(result.created).toBe(false);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects unknown contracts and incompatible versions', async () => {
    const tx = { $queryRaw: vi.fn(), $executeRaw: vi.fn() };
    await expect(appendDomainEvent(tx as never, {
      operationId: 'bad', type: 'CombatFinished', schemaVersion: 2,
      payload: { combatId: 'bad', participants: [{ characterId: 'c1' }] },
    })).rejects.toThrow('schema version 1');
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });

  it('drops AFK contribution effects while preserving the event', () => {
    const effects = materializeDomainEffects({
      ...record,
      payload: {
        combatId: 'combat-1', participants: [{ characterId: 'c1' }],
        contributions: [
          { subjectType: 'CHARACTER', subjectId: 'c1', kind: 'COMBAT_PARTICIPATION', amount: 1, metadata: { afk: true } },
          { subjectType: 'CHARACTER', subjectId: 'c2', kind: 'COMBAT_PARTICIPATION', amount: 1, metadata: { actions: 2 } },
        ],
      },
    });
    expect(effects.contributions.map((value) => value.subjectId)).toEqual(['c2']);
  });

  it('validates replay ranges before writing', async () => {
    const client = { $executeRaw: vi.fn() };
    await expect(requeueDomainEvents(client as never, {
      from: new Date('2026-08-02T00:00:00Z'), to: new Date('2026-08-01T00:00:00Z'),
    })).rejects.toThrow('cannot be later');
    expect(client.$executeRaw).not.toHaveBeenCalled();
  });
});
