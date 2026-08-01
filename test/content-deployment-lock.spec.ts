import { describe, expect, it, vi } from 'vitest';
import { acquireContentLock, type SqlClient } from '../src/content/content-deployment.store.js';

describe('content deployment advisory lock', () => {
  it('does not expose PostgreSQL void columns to Prisma', async () => {
    const queryRaw = vi.fn().mockResolvedValue([{ locked: true }]);
    const client = { $queryRaw: queryRaw } as unknown as SqlClient;

    await acquireContentLock(client);

    expect(queryRaw).toHaveBeenCalledOnce();
    const query = queryRaw.mock.calls[0]?.[0] as { strings?: readonly string[] };
    const sql = query.strings?.join('?') ?? '';
    expect(sql).toContain('SELECT TRUE AS "locked"');
    expect(sql).toContain('FROM (SELECT pg_advisory_xact_lock(');
  });

  it('fails closed when the lock query does not confirm acquisition', async () => {
    const client = {
      $queryRaw: vi.fn().mockResolvedValue([]),
    } as unknown as SqlClient;

    await expect(acquireContentLock(client)).rejects.toThrow(
      'Content deployment advisory lock could not be acquired.',
    );
  });
});
