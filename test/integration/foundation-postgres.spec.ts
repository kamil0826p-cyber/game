import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deployContentPackage } from '../../src/foundation/content/content.deployment.js';
import type { ContentManifest } from '../../src/foundation/content/content.types.js';
import { ExactlyOnceEventConsumer } from '../../src/foundation/events/outbox.worker.js';
import { buildEconomyReconciliation } from '../../src/foundation/reports/foundation-report.js';
import type { PrismaService } from '../../src/database/prisma.service.js';
import { PrismaClient } from '../../src/generated/prisma/client.js';

const enabled = process.env.RUN_POSTGRES_TESTS === '1';
const integration = enabled ? describe : describe.skip;
const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://game:game@localhost:5432/grid_mmorpg?schema=public';

integration('production foundation with PostgreSQL', () => {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const testId = randomUUID();
  const firebaseUid = `foundation-ci-${testId}`;
  const characterName = `Foundation${testId.replaceAll('-', '').slice(0, 10)}`;
  const consumerName = `foundation-test:${testId}`;
  let characterId = '';

  beforeAll(async () => {
    await prisma.$connect();
    const realm = await prisma.realm.findUniqueOrThrow({ where: { slug: 'world-1' } });
    const map = await prisma.map.findUniqueOrThrow({
      where: { realmId_key: { realmId: realm.id, key: 'greenfields' } },
    });
    const user = await prisma.user.create({ data: { firebaseUid } });
    const character = await prisma.character.create({
      data: {
        userId: user.id,
        realmId: realm.id,
        mapId: map.id,
        name: characterName,
        class: 'WARRIOR',
        gender: 'MALE',
        outfitKey: 'warrior-male',
        x: map.spawnX,
        y: map.spawnY,
        hp: 150,
        maxHp: 150,
        energy: 80,
        maxEnergy: 80,
        strength: 15,
        agility: 8,
        intelligence: 4,
        armor: 10,
      },
    });
    characterId = character.id;
  });

  afterAll(async () => {
    if (characterId) {
      await prisma.user.deleteMany({ where: { firebaseUid } });
      await prisma.domainEvent.deleteMany({ where: { characterId } });
    }
    await prisma.eventInbox.deleteMany({ where: { consumer: consumerName } });
    await prisma.$disconnect();
  });

  it('deploys the same content package idempotently without a duplicate version', async () => {
    const active = await prisma.activeContentVersion.findUniqueOrThrow({
      where: { id: 'active' },
      include: { contentVersion: true },
    });
    const manifest = active.contentVersion.manifest as unknown as ContentManifest;
    const before = await prisma.contentVersion.count();
    const first = await deployContentPackage(prisma, manifest);
    const second = await deployContentPackage(prisma, manifest);
    const after = await prisma.contentVersion.count();

    expect(first.created).toBe(false);
    expect(second.created).toBe(false);
    expect(first.hash).toBe(active.contentVersion.hash);
    expect(second.hash).toBe(active.contentVersion.hash);
    expect(after).toBe(before);
  });

  it('writes currency, item and quest events with outbox rows in the domain transaction', async () => {
    const operationId = `foundation-credit:${testId}`;
    await prisma.$transaction(async (transaction) => {
      const updated = await transaction.character.update({
        where: { id: characterId },
        data: { silver: { increment: 50 } },
        select: { silver: true },
      });
      await transaction.characterCurrencyLedger.create({
        data: {
          characterId,
          operationId,
          currency: 'SILVER',
          direction: 'CREDIT',
          amount: 50,
          reason: 'FOUNDATION_TEST',
          balanceAfter: updated.silver,
        },
      });
    });

    const currencyEvent = await prisma.domainEvent.findFirstOrThrow({
      where: { characterId, type: 'currency.changed', operationId },
      include: { outbox: true },
    });
    expect(currencyEvent.outbox?.status).toBe('PENDING');
    expect(currencyEvent.critical).toBe(true);
    expect(currencyEvent.contentVersionHash).toMatch(/^[a-f0-9]{64}$/);

    const itemDefinition = await prisma.itemDefinition.findUniqueOrThrow({
      where: { key: 'minor-health-potion' },
    });
    const item = await prisma.inventoryItem.create({
      data: {
        characterId,
        itemDefinitionId: itemDefinition.id,
        quantity: 2,
        slotIndex: 0,
      },
    });
    expect(item.definitionVersionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await prisma.domainEvent.count({
        where: { characterId, type: 'item.acquired' },
      }),
    ).toBeGreaterThan(0);

    const questDefinition = await prisma.questDefinition.findUniqueOrThrow({
      where: { key: 'rabbit-fur-for-mira' },
    });
    const quest = await prisma.characterQuest.create({
      data: {
        characterId,
        questDefinitionId: questDefinition.id,
        status: 'ACTIVE',
        startedAt: new Date(),
      },
    });
    expect(quest.definitionVersionHash).toMatch(/^[a-f0-9]{64}$/);
    await prisma.characterQuest.update({
      where: { id: quest.id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
    expect(
      await prisma.domainEvent.count({
        where: { characterId, type: { in: ['quest.accepted', 'quest.completed'] } },
      }),
    ).toBe(2);
  });

  it('rolls back both the mutation and its event when a domain transaction fails', async () => {
    const operationId = `foundation-rollback:${testId}`;
    await expect(
      prisma.$transaction(async (transaction) => {
        const updated = await transaction.character.update({
          where: { id: characterId },
          data: { gold: { increment: 10 } },
          select: { gold: true },
        });
        await transaction.characterCurrencyLedger.create({
          data: {
            characterId,
            operationId,
            currency: 'GOLD',
            direction: 'CREDIT',
            amount: 10,
            reason: 'ROLLBACK_TEST',
            balanceAfter: updated.gold,
          },
        });
        throw new Error('force rollback');
      }),
    ).rejects.toThrow('force rollback');

    expect(
      await prisma.characterCurrencyLedger.count({ where: { characterId, operationId } }),
    ).toBe(0);
    expect(await prisma.domainEvent.count({ where: { operationId } })).toBe(0);
    expect((await prisma.character.findUniqueOrThrow({ where: { id: characterId } })).gold).toBe(0);
  });

  it('applies a replayed event effect exactly once across five attempts', async () => {
    const consumer = new ExactlyOnceEventConsumer(prisma as unknown as PrismaService);
    const eventId = randomUUID();
    const operationId = `foundation-inbox:${testId}`;
    const results: Array<'processed' | 'duplicate'> = [];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      results.push(
        await consumer.consume(consumerName, eventId, async (transaction) => {
          const updated = await transaction.character.update({
            where: { id: characterId },
            data: { silver: { increment: 1 } },
            select: { silver: true },
          });
          await transaction.characterCurrencyLedger.create({
            data: {
              characterId,
              operationId,
              currency: 'SILVER',
              direction: 'CREDIT',
              amount: 1,
              reason: 'INBOX_TEST',
              balanceAfter: updated.silver,
            },
          });
        }),
      );
    }

    expect(results).toEqual(['processed', 'duplicate', 'duplicate', 'duplicate', 'duplicate']);
    expect(
      await prisma.characterCurrencyLedger.count({ where: { characterId, operationId } }),
    ).toBe(1);
  });

  it('reconciles character balances one-to-one with the immutable ledger', async () => {
    const reconciliation = await buildEconomyReconciliation(prisma);
    const rows = reconciliation.rows.filter((row) => row.characterId === characterId);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: 'SILVER', difference: 0 }),
        expect.objectContaining({ currency: 'GOLD', difference: 0 }),
      ]),
    );
  });
});
