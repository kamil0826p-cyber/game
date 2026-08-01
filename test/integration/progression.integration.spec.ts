import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { calculateCharacterStats } from '../../src/modules/progression/character-stats.js';
import { ProgressionService } from '../../src/modules/progression/progression.service.js';
import { Prisma, PrismaClient } from '../../src/generated/prisma/client.js';

const describeDb = process.env.RUN_DB_TESTS === 'true' ? describe : describe.skip;

describeDb('canonical progression integration', () => {
  let prisma: PrismaClient;
  let service: ProgressionService;
  const userIds: string[] = [];
  const definitionIds: string[] = [];

  beforeAll(() => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for progression integration tests.');
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
    service = new ProgressionService(prisma as never);
  });

  afterAll(async () => {
    if (userIds.length > 0) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (definitionIds.length > 0) await prisma.itemDefinition.deleteMany({ where: { id: { in: definitionIds } } });
    await prisma.$disconnect();
  });

  async function createCharacter(level: number, silver = 10_000) {
    const userId = randomUUID();
    const characterId = randomUUID();
    userIds.push(userId);
    const location = await prisma.$queryRaw<Array<{ realmId: string; mapId: string }>>(Prisma.sql`
      SELECT realm."id" AS "realmId", map."id" AS "mapId"
      FROM "Realm" realm JOIN "Map" map ON map."realmId" = realm."id"
      WHERE realm."slug" = 'world-1' AND map."key" = 'greenfields'
      LIMIT 1
    `);
    const current = location[0];
    if (!current) throw new Error('Seeded world-1/greenfields is required.');
    const stats = calculateCharacterStats({ characterClass: 'WARRIOR', level }).effective;
    await prisma.user.create({ data: { id: userId, firebaseUid: `progression-${userId}` } });
    await prisma.character.create({
      data: {
        id: characterId,
        userId,
        realmId: current.realmId,
        name: `P${characterId.replaceAll('-', '').slice(0, 15)}`,
        class: 'WARRIOR',
        level,
        experience: 0,
        outfitKey: 'warrior',
        mapId: current.mapId,
        x: 4,
        y: 4,
        direction: 'SOUTH',
        combatState: 'IDLE',
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        energy: stats.maxEnergy,
        maxEnergy: stats.maxEnergy,
        strength: stats.strength,
        agility: stats.agility,
        intelligence: stats.intelligence,
        armor: stats.armor,
        silver,
        gold: 0,
      },
    });
    return { userId, characterId };
  }

  it('keeps choice and respec operations idempotent and auditable', async () => {
    const character = await createCharacter(10);
    const operationId = `choice:${randomUUID()}`;
    const first = await service.choose(character.userId, character.characterId, operationId, 'ENDURANCE');
    const replay = await service.choose(character.userId, character.characterId, operationId, 'ENDURANCE');
    expect(first.snapshot.choices).toEqual(['ENDURANCE']);
    expect(replay.snapshot.choices).toEqual(['ENDURANCE']);
    const audits = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS "count" FROM "CharacterProgressionAudit"
      WHERE "characterId" = ${character.characterId}::uuid AND "operationId" = ${operationId}
    `);
    expect(Number(audits[0]?.count)).toBe(1);

    const beforeSilver = replay.silver;
    const reset = await service.respec(
      character.userId,
      character.characterId,
      `respec:${randomUUID()}`,
    );
    expect(reset.snapshot.choices).toEqual([]);
    expect(reset.snapshot.respec.freeRespecs).toBe(0);
    expect(reset.silver).toBe(beforeSilver);
  });

  it('recalculates level ups with equipment and reverses only the item impact', async () => {
    const character = await createCharacter(9);
    const definition = await prisma.itemDefinition.create({
      data: {
        key: `progression-test-${randomUUID()}`,
        name: 'Progression test armor',
        description: 'Integration-only item.',
        stackLimit: 1,
        metadata: {
          category: 'EQUIPMENT',
          equipmentSlot: 'CHEST',
          statBonuses: { maxHp: 20, strength: 5, armor: 2 },
        },
      },
    });
    definitionIds.push(definition.id);
    const inventory = await prisma.inventoryItem.create({
      data: {
        characterId: character.characterId,
        itemDefinitionId: definition.id,
        quantity: 1,
        slotIndex: 0,
        equippedSlot: 'CHEST',
        instanceData: {},
      },
    });
    const equippedAtNine = await service.repairCharacter(character.userId, character.characterId);
    const levelNineBase = calculateCharacterStats({ characterClass: 'WARRIOR', level: 9 }).effective;
    expect(equippedAtNine.snapshot.effective.strength).toBe(levelNineBase.strength + 5);

    await prisma.character.update({ where: { id: character.characterId }, data: { level: 10 } });
    const leveled = await prisma.$transaction((tx) =>
      service.recalculateInTransaction(tx, character.characterId, 'ADD_MAX_DELTA'));
    const levelTenBase = calculateCharacterStats({ characterClass: 'WARRIOR', level: 10 }).effective;
    expect(leveled.snapshot.effective.strength).toBe(levelTenBase.strength + 5);
    expect(leveled.snapshot.effective.maxHp).toBe(levelTenBase.maxHp + 20);

    await prisma.inventoryItem.update({ where: { id: inventory.id }, data: { equippedSlot: null } });
    const unequipped = await prisma.$transaction((tx) =>
      service.recalculateInTransaction(tx, character.characterId, 'CLAMP'));
    expect(unequipped.snapshot.effective).toEqual(levelTenBase);

    await prisma.inventoryItem.update({ where: { id: inventory.id }, data: { equippedSlot: 'CHEST' } });
    const equippedAgain = await prisma.$transaction((tx) =>
      service.recalculateInTransaction(tx, character.characterId, 'CLAMP'));
    expect(equippedAgain.snapshot.effective.strength).toBe(levelTenBase.strength + 5);
    expect(equippedAgain.snapshot.effective.maxHp).toBe(levelTenBase.maxHp + 20);
  });

  it('repairs a stale cached stat snapshot during reconnect preparation', async () => {
    const character = await createCharacter(25);
    await prisma.character.update({
      where: { id: character.characterId },
      data: { maxHp: 9999, strength: 999, armor: 999 },
    });
    const repaired = await service.repairCharacter(character.userId, character.characterId);
    const expected = calculateCharacterStats({ characterClass: 'WARRIOR', level: 25 }).effective;
    expect(repaired.snapshot.effective).toEqual(expected);
    const stored = await prisma.character.findUniqueOrThrow({
      where: { id: character.characterId },
      select: { maxHp: true, strength: true, armor: true },
    });
    expect(stored).toMatchObject({ maxHp: expected.maxHp, strength: expected.strength, armor: expected.armor });
  });
});
