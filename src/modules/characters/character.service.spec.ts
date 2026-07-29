import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { CharacterService, MAX_CHARACTERS_PER_REALM } from './character.service.js';

const realm = { id: '11111111-1111-4111-8111-111111111111', defaultMapId: '22222222-2222-4222-8222-222222222222' };
const baseCharacter = {
  id: '33333333-3333-4333-8333-333333333333',
  userId: '44444444-4444-4444-8444-444444444444',
  realmId: realm.id,
  name: 'Test Hero',
  class: 'MAGE',
  level: 1,
  experience: 0,
  outfitKey: 'mage-apprentice',
  mapId: realm.defaultMapId,
  x: 5,
  y: 7,
  direction: 'SOUTH',
  combatState: 'IDLE',
  hp: 75,
  maxHp: 75,
  energy: 120,
  maxEnergy: 120,
  strength: 4,
  agility: 7,
  intelligence: 14,
  armor: 2,
  silver: 0,
  gold: 0,
  stateVersion: 0,
  lastSavedAt: new Date('2026-07-29T10:00:00Z'),
  createdAt: new Date('2026-07-29T10:00:00Z'),
  updatedAt: new Date('2026-07-29T10:00:00Z'),
};

describe('CharacterService', () => {
  let transaction: any;
  let prisma: any;
  let service: CharacterService;

  beforeEach(() => {
    transaction = {
      $executeRaw: vi.fn().mockResolvedValue(1),
      character: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue(baseCharacter),
      },
      map: {
        findFirst: vi.fn().mockResolvedValue({ id: realm.defaultMapId, spawnX: 5, spawnY: 7 }),
      },
    };
    prisma = {
      user: { upsert: vi.fn() },
      character: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(baseCharacter),
        update: vi.fn().mockResolvedValue(baseCharacter),
      },
      $transaction: vi.fn(async (callback: (tx: any) => unknown) => callback(transaction)),
    };
    service = new CharacterService(prisma, { getCurrentRealm: vi.fn().mockResolvedValue(realm) } as any);
  });

  it('rejects creation when the account already has five characters', async () => {
    transaction.character.count.mockResolvedValue(MAX_CHARACTERS_PER_REALM);

    await expect(
      service.createCharacter(baseCharacter.userId, { name: 'Sixth Hero', characterClass: 'MAGE' }),
    ).rejects.toMatchObject({ code: GAME_ERROR_CODES.CHARACTER_LIMIT_REACHED });
    expect(transaction.character.create).not.toHaveBeenCalled();
  });

  it('creates a character while below the limit', async () => {
    const created = await service.createCharacter(baseCharacter.userId, {
      name: 'New Hero',
      characterClass: 'MAGE',
    });

    expect(transaction.$executeRaw).toHaveBeenCalledOnce();
    expect(transaction.character.count).toHaveBeenCalledWith({
      where: { userId: baseCharacter.userId, realmId: realm.id },
    });
    expect(created.id).toBe(baseCharacter.id);
  });

  it('rejects a locked outfit', async () => {
    await expect(
      service.changeOutfit(baseCharacter.userId, baseCharacter.id, 'mage-archmage'),
    ).rejects.toBeInstanceOf(GameError);
    await expect(
      service.changeOutfit(baseCharacter.userId, baseCharacter.id, 'mage-archmage'),
    ).rejects.toMatchObject({ code: GAME_ERROR_CODES.CHARACTER_OUTFIT_LOCKED });
    expect(prisma.character.update).not.toHaveBeenCalled();
  });

  it('persists an unlocked outfit', async () => {
    prisma.character.update.mockResolvedValue({ ...baseCharacter, outfitKey: 'mage-frost', stateVersion: 1 });

    const updated = await service.changeOutfit(baseCharacter.userId, baseCharacter.id, 'mage-frost');

    expect(updated.outfitKey).toBe('mage-frost');
    expect(prisma.character.update).toHaveBeenCalledWith({
      where: { id: baseCharacter.id },
      data: {
        outfitKey: 'mage-frost',
        stateVersion: { increment: 1 },
        lastSavedAt: expect.any(Date),
      },
    });
  });
});
