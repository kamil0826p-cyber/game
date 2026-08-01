import { describe, expect, it, vi } from 'vitest';
import { CharacterService } from '../src/modules/characters/character.service.js';

const createHarness = () => {
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
  const progression = {
    initialStats: vi.fn().mockReturnValue({
      maxHp: 75,
      maxEnergy: 120,
      strength: 4,
      agility: 7,
      intelligence: 14,
      armor: 2,
    }),
    initialProgressionData: vi.fn().mockReturnValue({
      milestones: {},
      legacyAdjustment: {},
      permanent: {},
      temporary: {},
      audit: [],
    }),
  };
  return {
    progression,
    transaction,
    service: new CharacterService(
      prisma as never,
      realmService as never,
      progression as never,
    ),
  };
};

describe('CharacterService', () => {
  it('executes the PostgreSQL advisory lock and creates the selected gender atomically', async () => {
    const { service, transaction, progression } = createHarness();

    const character = await service.createCharacter('user-id', {
      name: 'Second Hero',
      characterClass: 'MAGE',
      gender: 'FEMALE',
      outfitKey: 'mage-apprentice',
    });

    expect(transaction.$executeRaw).toHaveBeenCalledTimes(1);
    expect(transaction.$executeRaw.mock.calls[0]?.[1]).toBe('user-id:realm-id');
    expect(transaction.character.count).toHaveBeenCalledWith({
      where: { userId: 'user-id', realmId: 'realm-id' },
    });
    expect(progression.initialStats).toHaveBeenCalledWith('MAGE');
    expect(transaction.character.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        gender: 'FEMALE',
        outfitKey: 'mage-apprentice',
        progressionVersion: 1,
        freeRespecAvailable: true,
      }),
    });
    expect(character).toMatchObject({
      id: 'character-id',
      userId: 'user-id',
      realmId: 'realm-id',
      name: 'Second Hero',
      gender: 'FEMALE',
      mapId: 'map-id',
      x: 4,
      y: 4,
    });
  });

  it('defaults legacy creation calls to male', async () => {
    const { service, transaction } = createHarness();

    const character = await service.createCharacter('user-id', {
      name: 'Legacy Hero',
      characterClass: 'WARRIOR',
    });

    expect(transaction.character.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ gender: 'MALE' }),
    });
    expect(character.gender).toBe('MALE');
  });
});
