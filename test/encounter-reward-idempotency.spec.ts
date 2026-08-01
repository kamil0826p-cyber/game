import { describe, expect, it, vi } from 'vitest';
import { MobRewardService } from '../src/modules/mobs/mob-reward.service.js';
import type { RuntimeMob } from '../src/modules/mobs/mob.types.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';

const settlement = {
  experienceGained: 120,
  levelsGained: 1,
  skillPointsGained: 1,
  nextLevelExperience: 320,
  loot: [
    {
      itemKey: 'rabbit-pelt',
      name: 'Rabbit Pelt',
      description: 'A pelt.',
      rarity: 'COMMON' as const,
      icon: 'pelt',
      quantity: 1,
      stackLimit: 20,
      minimumLevel: 1,
      statBonuses: {},
    },
  ],
  skippedLoot: [],
};

const mob = {
  id: 'mob-id',
  definitionKey: 'rabbit-spawn',
  name: 'Rabbit Spawn',
  rank: 'SPAWN',
  mapId: 'map-a',
  x: 1,
  y: 1,
  level: 2,
  characterClass: 'ARCHER',
  outfitKey: 'mob-rabbit-spawn',
  renderScale: 1,
  respawnMs: 30_000,
  experience: 120,
  stats: {
    maxHp: 100,
    maxEnergy: 50,
    strength: 10,
    agility: 10,
    intelligence: 10,
    armor: 5,
  },
  loot: [],
  state: 'RESPAWNING',
} satisfies RuntimeMob;

describe('encounter reward idempotency', () => {
  it('returns the durable settlement without granting or progressing again', async () => {
    const transaction = {
      character: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'character-id',
          userId: 'user-id',
          silver: 25,
        }),
      },
      characterCurrencyLedger: {
        findUnique: vi.fn().mockResolvedValue({
          metadata: {
            kind: 'ENCOUNTER_REWARD',
            combatId: 'combat-id',
            encounterKey: 'brood-hunt',
            mobDefinitionKey: mob.definitionKey,
            settlement,
          },
        }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
      ),
    };
    const progression = {
      recomputeInTransaction: vi.fn(() => {
        throw new Error('reward replay must not recompute progression');
      }),
    };
    const quests = {
      recordMobKill: vi.fn(() => {
        throw new Error('reward replay must not progress quests');
      }),
    };
    const service = new MobRewardService(
      prisma as never,
      progression as never,
      quests as never,
    );
    const session = {
      characterId: 'character-id',
      userId: 'user-id',
    } as PlayerSession;

    await expect(
      service.award(session, mob, {
        combatId: 'combat-id',
        operationId: 'encounter:combat-id',
        encounterKey: 'brood-hunt',
      }),
    ).resolves.toEqual(settlement);
    expect(progression.recomputeInTransaction).not.toHaveBeenCalled();
    expect(quests.recordMobKill).not.toHaveBeenCalled();
    expect(transaction.characterCurrencyLedger.findUnique).toHaveBeenCalledWith({
      where: {
        characterId_operationId: {
          characterId: 'character-id',
          operationId: 'encounter:combat-id',
        },
      },
      select: { metadata: true },
    });
  });
});
