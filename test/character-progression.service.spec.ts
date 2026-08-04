import { describe, expect, it, vi } from 'vitest';
import { GAME_ERROR_CODES } from '../src/common/errors/game.error.js';
import { CharacterProgressionService } from '../src/modules/characters/progression/character-progression.service.js';

const initialProgressionData = {
  milestones: {},
  legacyAdjustment: {
    maxHp: 0,
    maxEnergy: 0,
    strength: 0,
    agility: 0,
    intelligence: 0,
    armor: 0,
  },
  permanent: {
    maxHp: 0,
    maxEnergy: 0,
    strength: 0,
    agility: 0,
    intelligence: 0,
    armor: 0,
  },
  temporary: {
    maxHp: 0,
    maxEnergy: 0,
    strength: 0,
    agility: 0,
    intelligence: 0,
    armor: 0,
  },
  audit: [],
};

const createHarness = () => {
  const character = {
    id: 'character-id',
    userId: 'user-id',
    realmId: 'realm-id',
    name: 'Warrior',
    class: 'WARRIOR' as const,
    gender: 'MALE' as const,
    level: 10,
    experience: 0,
    outfitKey: 'warrior-recruit',
    mapId: 'map-id',
    x: 1,
    y: 1,
    direction: 'SOUTH' as const,
    combatState: 'IDLE' as const,
    hp: 235,
    maxHp: 235,
    energy: 99,
    maxEnergy: 99,
    strength: 27,
    agility: 13,
    intelligence: 6,
    armor: 15,
    silver: 10_000,
    gold: 0,
    progressionVersion: 1,
    progressionData: structuredClone(initialProgressionData),
    freeRespecAvailable: true,
    progressionMigratedAt: new Date('2026-08-01T00:00:00.000Z'),
    stateVersion: 4,
    lastSavedAt: new Date('2026-08-01T00:00:00.000Z'),
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-01T00:00:00.000Z'),
    inventoryItems: [],
  };
  const ledger = new Map<string, { metadata: unknown }>();
  const transaction = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    character: {
      findFirst: vi.fn().mockImplementation(async () => character),
      findUnique: vi.fn().mockImplementation(async () => character),
      update: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        for (const [key, value] of Object.entries(data)) {
          if (key === 'stateVersion' && typeof value === 'object' && value) {
            character.stateVersion += Number((value as { increment?: unknown }).increment ?? 0);
            continue;
          }
          Object.assign(character, { [key]: value });
        }
        character.updatedAt = new Date('2026-08-01T00:01:00.000Z');
        return character;
      }),
    },
    characterCurrencyLedger: {
      findUnique: vi.fn().mockImplementation(async ({ where }: { where: { characterId_operationId: { operationId: string } } }) =>
        ledger.get(where.characterId_operationId.operationId) ?? null,
      ),
      create: vi.fn().mockImplementation(async ({ data }: { data: { operationId: string; metadata: unknown } }) => {
        const entry = { metadata: data.metadata };
        ledger.set(data.operationId, entry);
        return entry;
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(
      async (run: (client: typeof transaction) => Promise<unknown>) => run(transaction),
    ),
  };
  return {
    character,
    ledger,
    transaction,
    service: new CharacterProgressionService(prisma as never),
  };
};

describe('CharacterProgressionService respec idempotency', () => {
  it('returns the stored snapshot without applying the same operation twice', async () => {
    const { character, ledger, service, transaction } = createHarness();

    const first = await service.respec('user-id', 'character-id', 'same-operation', {
      VITALITY: 1,
    });
    const second = await service.respec('user-id', 'character-id', 'same-operation', {
      VITALITY: 1,
    });

    expect(second).toEqual(first);
    expect(character.silver).toBe(10_000);
    expect(character.freeRespecAvailable).toBe(false);
    expect(transaction.character.update).toHaveBeenCalledTimes(1);
    expect(transaction.characterCurrencyLedger.create).toHaveBeenCalledTimes(1);
    expect(ledger.size).toBe(1);
  });

  it('rejects reuse of an operation id with a different payload', async () => {
    const { service } = createHarness();

    await service.respec('user-id', 'character-id', 'same-operation', {
      VITALITY: 1,
    });

    await expect(
      service.respec('user-id', 'character-id', 'same-operation', {
        MASTERY: 1,
      }),
    ).rejects.toMatchObject({ code: GAME_ERROR_CODES.INVALID_PAYLOAD });
  });
});

describe('CharacterProgressionService absolute resource policy', () => {
  it('does not heal when the calculated resource maximum increases', async () => {
    const { character, service, transaction } = createHarness();
    character.hp = 200;
    character.energy = 70;
    character.level = 11;

    const result = await service.recomputeInTransaction(
      transaction as never,
      character.id,
      { preserveAbsoluteResources: true },
    );

    expect(result.maxHp).toBeGreaterThan(235);
    expect(result.maxEnergy).toBeGreaterThanOrEqual(99);
    expect(result.hp).toBe(200);
    expect(result.energy).toBe(70);
  });

  it('only clamps resources when the calculated maximum decreases', async () => {
    const { character, service, transaction } = createHarness();
    character.level = 9;

    const result = await service.recomputeInTransaction(
      transaction as never,
      character.id,
      { preserveAbsoluteResources: true },
    );

    expect(result.maxHp).toBeLessThan(235);
    expect(result.hp).toBe(result.maxHp);
    expect(result.energy).toBe(Math.min(99, result.maxEnergy));
  });
});
