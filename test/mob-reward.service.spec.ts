import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MobRewardService } from '../src/modules/mobs/mob-reward.service.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';

function session(): PlayerSession {
  return {
    socketId: 'socket-1', connectionId: 'connection-1', userId: 'user-1', characterId: 'char-1', realmId: 'realm-1', mapId: 'map-1',
    name: 'Hero', characterClass: 'WARRIOR', gender: 'MALE', locale: 'pl', level: 1, experience: 0, silver: 0, gold: 0,
    outfitKey: 'warrior', x: 2, y: 2, direction: 'SOUTH', combatState: 'IDLE', hp: 100, maxHp: 100, energy: 100,
    maxEnergy: 100, strength: 10, agility: 10, intelligence: 10, armor: 10, viewport: { halfWidth: 10, halfHeight: 10 },
    stateRevision: 0, persistedRevision: 0, nextMoveAllowedAt: 0, dirty: false, connectedAt: Date.now(), activeInWorld: true,
    visibleCharacterIds: new Set(), watcherCharacterIds: new Set(),
  };
}
function mob() {
  return {
    id: 'mob-1', definitionId: 'def-1', definitionKey: 'spawn-rabbit-1', mapId: 'map-1', name: 'Królik', rank: 'SPAWN' as const,
    level: 2, outfitKey: 'rabbit', renderScale: 0.5, characterClass: 'ARCHER' as const, x: 3, y: 3, alive: true, reservedByCombatId: undefined,
    respawnAt: undefined, hp: 70, maxHp: 70, energy: 0, maxEnergy: 0, strength: 8, agility: 12, intelligence: 1, armor: 2, experience: 150,
    loot: [{ itemKey: 'rabbit-fur', chance: 1, minQuantity: 2, maxQuantity: 2 }], respawnMs: 1000,
  };
}

describe('MobRewardService', () => {
  const character = { id: 'char-1', userId: 'user-1', level: 1, experience: 0 };
  const canonical = {
    snapshot: {
      effective: { maxHp: 111, maxEnergy: 72, strength: 15, agility: 7, intelligence: 3, armor: 8 },
    },
    hp: 111,
    energy: 72,
    silver: 0,
    stateVersion: 1,
    statRevision: 1,
  };
  const definition = {
    id: 'item-def', key: 'rabbit-fur', name: 'Futro', description: 'Futro', stackLimit: 50,
    metadata: { category: 'MATERIAL', rarity: 'COMMON', icon: 'F' },
  };
  let tx: any;
  let prisma: any;
  let quests: any;
  let domainEvents: any;
  let progression: any;

  beforeEach(() => {
    tx = {
      character: { findUnique: vi.fn().mockResolvedValue(character), update: vi.fn().mockResolvedValue({}) },
      itemDefinition: { findMany: vi.fn().mockResolvedValue([definition]) },
      inventoryItem: { findMany: vi.fn().mockResolvedValue([]), update: vi.fn(), create: vi.fn().mockResolvedValue({ id: 'inv', characterId: 'char-1', itemDefinitionId: 'item-def', quantity: 2, slotIndex: 0 }) },
    };
    prisma = { $transaction: vi.fn((callback: (client: any) => unknown) => callback(tx)) };
    quests = { recordMobKill: vi.fn().mockResolvedValue(undefined) };
    domainEvents = { append: vi.fn().mockResolvedValue({ created: true, event: { id: 'event-1' } }) };
    progression = { recalculateInTransaction: vi.fn().mockResolvedValue(canonical) };
  });

  it('persists progression, grants loot and synchronizes the online session', async () => {
    const player = session();
    const service = new MobRewardService(prisma as never, domainEvents as never, progression as never, quests as never);
    const reward = await service.award(player, mob());
    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.character.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { level: 2, experience: 15 },
    }));
    expect(progression.recalculateInTransaction).toHaveBeenCalledWith(tx, 'char-1', 'ADD_MAX_DELTA');
    expect(tx.inventoryItem.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ characterId: 'char-1', quantity: 2, instanceData: expect.any(Object) }) }));
    expect(domainEvents.append).toHaveBeenCalledWith(tx, expect.objectContaining({ type: 'MobDefeated' }));
    expect(domainEvents.append).toHaveBeenCalledWith(tx, expect.objectContaining({ type: 'ItemAcquired' }));
    expect(reward.experienceGained).toBe(150);
    expect(reward.levelsGained).toBe(1);
    expect(reward.loot[0]).toMatchObject({ itemKey: 'rabbit-fur', quantity: 2 });
    expect(player.level).toBe(2);
    expect(player.experience).toBe(15);
    expect(player.maxHp).toBe(111);
    expect(player.stateRevision).toBe(1);
    expect(player.persistedRevision).toBe(1);
    expect(quests.recordMobKill).toHaveBeenCalledWith('char-1', 'spawn-rabbit-1');
  });

  it('reports loot as skipped when the inventory is full', async () => {
    tx.inventoryItem.findMany.mockResolvedValue(Array.from({ length: 40 }, (_, slotIndex) => ({
      id: `item-${slotIndex}`, characterId: 'char-1', itemDefinitionId: `other-${slotIndex}`, quantity: 1, slotIndex, equippedSlot: null,
    })));
    const service = new MobRewardService(prisma as never, domainEvents as never, progression as never, quests as never);
    const reward = await service.award(session(), mob());
    expect(reward.loot).toEqual([]);
    expect(reward.skippedLoot[0]).toMatchObject({ itemKey: 'rabbit-fur', quantity: 2 });
    expect(tx.inventoryItem.create).not.toHaveBeenCalled();
    expect(domainEvents.append).toHaveBeenCalledWith(tx, expect.objectContaining({
      type: 'MobDefeated',
      payload: expect.objectContaining({ audit: expect.not.arrayContaining([expect.objectContaining({ resourceType: 'ITEM' })]) }),
    }));
  });
});
