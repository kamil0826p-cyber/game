import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import '../src/modules/combat/item-curse-combat.patch.js';
import { CombatEngine } from '../src/modules/combat/combat.engine.js';
import type {
  CombatActorInput,
  CombatTeamInput,
} from '../src/modules/combat/combat.types.js';
import {
  cacheEquippedItemCurseModifiers,
  drainItemCurseCorruptionWrites,
  ItemCurseRuntimeService,
  itemCurseModifiersFromSnapshots,
  registerItemCurseCorruptionWriter,
  type EquippedItemCurseModifiers,
} from '../src/modules/items/item-curse-runtime.service.js';
import type {
  ItemCurseCost,
  ItemInstanceSnapshot,
} from '../src/modules/items/itemization.types.js';
import { SKILL_CATALOG } from '../src/modules/skills/skill.catalog.js';

const modifiers = (
  overrides: Partial<EquippedItemCurseModifiers> = {},
): EquippedItemCurseModifiers => ({
  healingReceivedMultiplier: 1,
  healingConsumablesLocked: false,
  corruptionByTrigger: {
    SKILL_CAST: 0,
    GUARD_SUCCESS: 0,
    COMBAT_END: 0,
  },
  ...overrides,
  corruptionByTrigger: {
    SKILL_CAST: 0,
    GUARD_SUCCESS: 0,
    COMBAT_END: 0,
    ...overrides.corruptionByTrigger,
  },
});

const cursedSnapshot = (
  key: string,
  cost: ItemCurseCost,
): ItemInstanceSnapshot => ({
  version: 1,
  affixRulesVersion: 1,
  relicRulesVersion: 1,
  definitionKey: `test-${key}`,
  archetypeKey: `test-${key}`,
  category: 'EQUIPMENT',
  equipmentSlot: 'RING',
  rarity: 'COMMON',
  powerLevel: 1,
  powerBudget: 10,
  powerSpent: 0,
  seed: `seed-${key}`,
  affixes: [],
  curse: {
    key,
    name: key,
    description: key,
    preview: key,
    cost,
    powerCredit: 0,
    rulesVersion: 1,
  },
  craftQuality: 0,
  origin: {
    source: 'ADMIN',
    sourceKey: key,
    operationId: `create-${key}`,
    contentVersion: 1,
    generatedAt: new Date(0).toISOString(),
  },
  bindPolicy: 'NONE',
  tradePolicy: 'TRADEABLE',
  salvagePolicy: 'ALLOWED',
  mutations: [
    {
      sequence: 1,
      operationId: `create-${key}`,
      type: 'CREATE',
      at: new Date(0).toISOString(),
      afterHash: 'a'.repeat(64),
    },
  ],
});

const skill = (key: string) => {
  const definition = SKILL_CATALOG.find((candidate) => candidate.key === key);
  if (!definition) throw new Error(`Missing test skill ${key}`);
  return { definition, cooldownTurnsRemaining: 0 };
};

const actor = (
  actorId: string,
  overrides: Partial<CombatActorInput> = {},
): CombatActorInput => ({
  actorId,
  characterId: actorId,
  kind: 'PLAYER',
  name: actorId,
  characterClass: 'WARRIOR',
  level: 40,
  outfitKey: 'warrior-vanguard',
  hp: 200,
  maxHp: 200,
  energy: 120,
  maxEnergy: 120,
  strength: 30,
  agility: 10,
  intelligence: 8,
  armor: 12,
  skills: [skill('warrior-last-stand')],
  ...overrides,
});

const team = (
  anchorActorId: string,
  actors: CombatActorInput[],
): CombatTeamInput => ({ anchorActorId, actors });

const activeCombat = (
  combatId: string,
  first: CombatActorInput,
  second: CombatActorInput,
) => {
  const engine = new CombatEngine(() => 0.5);
  const runtime = engine.createRequest(
    combatId,
    'PVP',
    'map-a',
    team(first.actorId, [first]),
    team(second.actorId, [second]),
    1_000,
    31_000,
  );
  engine.start(runtime, 1_000);
  return { engine, runtime };
};

afterEach(async () => {
  await drainItemCurseCorruptionWrites();
  registerItemCurseCorruptionWriter(undefined);
});

describe('item curse runtime', () => {
  it('combines healing, consumable lock and corruption trigger costs', () => {
    const result = itemCurseModifiersFromSnapshots([
      cursedSnapshot('healing', {
        type: 'HEALING_RECEIVED_MULTIPLIER',
        multiplier: 0.8,
      }),
      cursedSnapshot('consumable', {
        type: 'CONSUMABLE_LOCK',
        category: 'HEALING',
      }),
      cursedSnapshot('corruption-a', {
        type: 'CORRUPTION_ON_TRIGGER',
        trigger: 'SKILL_CAST',
        amount: 2,
      }),
      cursedSnapshot('corruption-b', {
        type: 'CORRUPTION_ON_TRIGGER',
        trigger: 'SKILL_CAST',
        amount: 3,
      }),
    ]);

    expect(result).toEqual({
      healingReceivedMultiplier: 0.8,
      healingConsumablesLocked: true,
      corruptionByTrigger: {
        SKILL_CAST: 5,
        GUARD_SUCCESS: 0,
        COMBAT_END: 0,
      },
    });
  });

  it('blocks healing consumables while a consumable-lock curse is equipped', async () => {
    const database = {
      inventoryItem: {
        findFirst: vi.fn().mockResolvedValue({
          itemDefinition: {
            metadata: {
              category: 'CONSUMABLE',
              rarity: 'COMMON',
              icon: '◆',
              effect: { hp: 35 },
              buyPriceSilver: 1,
              sellPriceSilver: 1,
            },
          },
        }),
      },
    } as unknown as PrismaService;
    const service = new ItemCurseRuntimeService(database);
    vi.spyOn(service, 'getEquippedModifiers').mockResolvedValue(
      modifiers({ healingConsumablesLocked: true }),
    );

    await expect(
      service.assertHealingConsumableAllowed('user-a', 'character-a', 'item-a'),
    ).rejects.toMatchObject({ code: 'ITEM_CURSE_RESTRICTION' });
  });

  it('reduces received combat healing and records skill-cast corruption', async () => {
    const writes: Array<{ characterId: string; amount: number; operationId: string }> = [];
    registerItemCurseCorruptionWriter(async (characterId, amount, operationId) => {
      writes.push({ characterId, amount, operationId });
      return amount;
    });
    cacheEquippedItemCurseModifiers(
      'healer',
      modifiers({
        healingReceivedMultiplier: 0.8,
        corruptionByTrigger: { SKILL_CAST: 2 },
      }),
    );
    const { engine, runtime } = activeCombat(
      '00000000-0000-4000-8000-000000000101',
      actor('healer', { agility: 30, hp: 100, maxHp: 200 }),
      actor('enemy', { agility: 10 }),
    );

    const snapshot = engine.act(
      runtime,
      'healer',
      { action: 'SKILL', skillKey: 'warrior-last-stand' },
      2_000,
    );
    await drainItemCurseCorruptionWrites();

    expect(
      snapshot.participants.find((participant) => participant.actorId === 'healer')?.hp,
    ).toBe(148);
    expect(snapshot.recentActions.at(-1)?.results[0]?.hpDelta).toBe(48);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ characterId: 'healer', amount: 2 });
  });

  it('records guard-success and combat-end corruption exactly once', async () => {
    const writes: Array<{ characterId: string; amount: number; operationId: string }> = [];
    registerItemCurseCorruptionWriter(async (characterId, amount, operationId) => {
      writes.push({ characterId, amount, operationId });
      return amount;
    });
    cacheEquippedItemCurseModifiers(
      'guardian',
      modifiers({
        corruptionByTrigger: { GUARD_SUCCESS: 4, COMBAT_END: 7 },
      }),
    );
    const { engine, runtime } = activeCombat(
      '00000000-0000-4000-8000-000000000102',
      actor('guardian', { agility: 30 }),
      actor('attacker', { agility: 10 }),
    );

    engine.act(runtime, 'guardian', { action: 'DEFEND' }, 2_000);
    engine.act(runtime, 'attacker', { action: 'BASIC_ATTACK' }, 3_000);
    engine.forfeit(runtime, 'attacker', 4_000);
    engine.forfeit(runtime, 'attacker', 5_000);
    await drainItemCurseCorruptionWrites();

    expect(writes.filter((write) => write.amount === 4)).toHaveLength(1);
    expect(writes.filter((write) => write.amount === 7)).toHaveLength(1);
  });
});
