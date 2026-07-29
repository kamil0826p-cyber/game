import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import { QuestService } from '../src/modules/quests/quest.service.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';

const definition = { id: '22222222-2222-4222-8222-222222222222', key: 'rabbit-fur-for-mira', name: 'Ciepło dla Greenfields', description: 'Przynieś pięć futer.', minimumLevel: 1, steps: [{ id: 'fur', type: 'COLLECT_ITEM', itemKey: 'rabbit-fur', quantity: 5, consumeOnComplete: true }], rewards: { experience: 180, gold: 0, silver: 300 } };
const characterQuest = { id: '33333333-3333-4333-8333-333333333333', characterId: '44444444-4444-4444-8444-444444444444', questDefinitionId: definition.id, status: 'ACTIVE', progress: { counters: {} }, startedAt: new Date(), completedAt: null, createdAt: new Date(), updatedAt: new Date(), questDefinition: definition };
const createSession = (): PlayerSession => ({ socketId: 'socket', connectionId: 'connection', characterId: characterQuest.characterId, userId: '55555555-5555-4555-8555-555555555555', realmId: 'realm', name: 'Tester', characterClass: 'WARRIOR', level: 2, experience: 0, outfitKey: 'warrior-recruit', mapId: 'map', x: 1, y: 1, direction: 'SOUTH', combatState: 'IDLE', locale: 'pl', viewport: { halfWidth: 10, halfHeight: 10 }, connectedAt: Date.now(), nextMoveAllowedAt: 0, stateRevision: 1, persistedRevision: 1, dirty: false, activeInWorld: true, visibleCharacterIds: new Set(), watcherCharacterIds: new Set(), hp: 100, maxHp: 100, energy: 20, maxEnergy: 20, strength: 10, agility: 8, intelligence: 4, armor: 6, silver: 0, gold: 0 });

function createService(furQuantity: number) {
  const items = furQuantity > 0 ? [{ id: '66666666-6666-4666-8666-666666666666', quantity: furQuantity, itemDefinition: { key: 'rabbit-fur' } }] : [];
  const transaction = {
    characterQuest: { findFirst: vi.fn().mockResolvedValue(characterQuest), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    inventoryItem: { findMany: vi.fn().mockResolvedValue(items), delete: vi.fn().mockResolvedValue(undefined), update: vi.fn().mockResolvedValue(undefined) },
    character: {
      findUnique: vi.fn().mockResolvedValue({ id: characterQuest.characterId, userId: createSession().userId, level: 2, experience: 0, hp: 100, maxHp: 100, energy: 20, maxEnergy: 20, strength: 10, agility: 8, intelligence: 4, armor: 6, gold: 0, silver: 0 }),
      update: vi.fn().mockResolvedValue({ id: characterQuest.characterId, level: 2, experience: 180, hp: 100, maxHp: 100, energy: 20, maxEnergy: 20, strength: 10, agility: 8, intelligence: 4, armor: 6, gold: 0, silver: 300, stateVersion: 2 }),
    },
    characterCurrencyLedger: { create: vi.fn().mockResolvedValue(undefined) },
  };
  const prisma = { $transaction: vi.fn((operation: (tx: typeof transaction) => unknown) => operation(transaction)) } as unknown as PrismaService;
  return { service: new QuestService(prisma), transaction };
}

describe('QuestService turn-in', () => {
  it('does not mutate state when required items are missing', async () => {
    const { service, transaction } = createService(4);
    await expect(service.turnIn(createSession(), definition.key, 'pl')).resolves.toMatchObject({ completed: false, state: 'ACTIVE' });
    expect(transaction.characterQuest.updateMany).not.toHaveBeenCalled(); expect(transaction.character.update).not.toHaveBeenCalled();
  });
  it('consumes items, closes the quest and grants rewards atomically', async () => {
    const player = createSession(); const { service, transaction } = createService(5);
    await expect(service.turnIn(player, definition.key, 'pl')).resolves.toMatchObject({ completed: true, state: 'REWARDED', reward: { experience: 180, gold: 0, silver: 300 } });
    expect(transaction.inventoryItem.delete).toHaveBeenCalled(); expect(transaction.characterCurrencyLedger.create).toHaveBeenCalledTimes(1); expect(player.gold).toBe(0); expect(player.silver).toBe(300);
  });
});