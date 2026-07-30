import { describe, expect, it, vi } from 'vitest';
import { CharacterService } from '../src/modules/characters/character.service.js';

describe('CharacterService', () => {
  it('executes the PostgreSQL advisory lock without deserializing its void result', async () => {
    const lastSavedAt = new Date('2026-07-30T00:00:00.000Z');
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      character: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({
          id: 'character-id',
          ...data,
          stateVersion: 0,
          lastSavedAt,
        })),
      },
      map: {
        findFirst: vi.fn().mockResolvedValue({ id: 'map-id', spawnX: 4, spawnY: 4 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(
        async (run: (client: typeof transaction) => Promise<unknown>) => run(transaction),
      ),
    };
    const realmService = {
      getCurrentRealm: vi.fn().mockResolvedValue({
        id: 'realm-id',
        slug: 'world-1',
        name: 'World 1',
        defaultMapId: 'map-id',
      }),
    };
    const service = new CharacterService(prisma as never, realmService as never);

    const character = await service.createCharacter('user-id', {
      name: 'Second Hero',
      characterClass: 'MAGE',
    });

    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw.mock.calls[0]?.[1]).toBe('user-id:realm-id');
    expect(transaction.character.count).toHaveBeenCalledWith({
      where: { userId: 'user-id', realmId: 'realm-id' },
    });
    expect(character).toMatchObject({
      id: 'character-id',
      userId: 'user-id',
      realmId: 'realm-id',
      name: 'Second Hero',
      mapId: 'map-id',
      x: 4,
      y: 4,
    });
  });
});
