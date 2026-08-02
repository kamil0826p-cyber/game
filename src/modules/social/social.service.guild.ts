import { createHash, randomUUID } from 'node:crypto';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type {
  SocialActivityCompletePayload,
  SocialAnnouncementCreatePayload,
  SocialBankDepositPayload,
  SocialBankWithdrawPayload,
  SocialEventCreatePayload,
  SocialFinderApplyPayload,
  SocialFinderCreatePayload,
  SocialFinderReadyPayload,
  SocialFinderRespondPayload,
  SocialGuildContributionPayload,
  SocialGuildCreateObjectivePayload,
  SocialMentorProfilePayload,
  SocialMentorshipProgressPayload,
  SocialMentorshipStartPayload,
  SocialRegionContributionPayload,
} from '../../contracts/social.schemas.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma, type GuildRole } from '../../generated/prisma/client.js';
import { GroupService } from '../groups/group.service.js';
import { ItemInventoryService } from '../items/item-inventory.service.js';
import {
  itemSnapshotHash,
  parseItemDefinitionMetadata,
  readItemInstanceSnapshot,
} from '../items/itemization.rules.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import {
  appendRecentPlayer,
  applyRegionContribution,
  assertFinderPartySize,
  assertStableActivityKey,
  contractProgress,
  finderMissingRequirements,
  freezeFinderListing,
  mentorshipCompletionAllowed,
  metricFillRate,
  metricLobbyDropoffRate,
  metricMentoringCompletionRate,
  projectStageProgress,
  rewardConcentration,
  updateFinderReadiness,
} from './social.engine.js';
import { GuildPermissionService, type GuildPermissionActor } from '../guilds/guild-permission.service.js';
import {
  emptyGuildSocialState,
  emptySocialRealmState,
  parseGuildSocialState,
  parseSocialRealmState,
} from './social.state.js';
import type {
  FinderApplicantState,
  FinderListingState,
  FinderMemberState,
  GuildBankAuditView,
  GuildBankItemView,
  GuildContractInstanceState,
  GuildProjectInstanceState,
  GuildSocialPermission,
  GuildSocialState,
  MentorshipState,
  ProcessedSocialOperation,
  RegionGoalState,
  SocialDashboardView,
  SocialRealmState,
} from './social.types.js';

const socialJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;
const operationPattern = /^[A-Za-z0-9:_-]{1,128}$/;
const ACTIVE_LISTING_STATUSES = new Set(['OPEN', 'LOBBY', 'FROZEN', 'STARTED']);
const BANK_WITHDRAW_DAILY_LIMIT: Record<GuildRole, number> = {
  LEADER: 1_000,
  OFFICER: 100,
  MEMBER: 10,
};

const CONTRACT_CATALOG = {
  'ashen-ward': {
    version: 1,
    title: 'Straż Popielnego Pogranicza',
    target: 100,
    rewardXp: 50,
    rewardUnlockKey: 'guild:contract-board:ashen',
    contributionKinds: ['ACTIVITY', 'REGION', 'PVP_OBJECTIVE'],
    perCharacterCap: 40,
    perAccountCap: 60,
  },
  'pilgrim-supply': {
    version: 1,
    title: 'Zaopatrzenie pielgrzymów',
    target: 80,
    rewardXp: 35,
    rewardUnlockKey: 'guild:caravan-cosmetics',
    contributionKinds: ['MATERIAL', 'CRAFT', 'ACTIVITY'],
    perCharacterCap: 30,
    perAccountCap: 45,
  },
} as const;

const PROJECT_CATALOG = {
  'ritual-hall': {
    version: 1,
    title: 'Sala rytuałów',
    stages: [
      { key: 'foundations', target: 100, contributionKinds: ['MATERIAL', 'REGION'] },
      { key: 'instruments', target: 60, contributionKinds: ['CRAFT', 'ACTIVITY'] },
      { key: 'consecration', target: 30, contributionKinds: ['CHOICE', 'ACTIVITY'] },
    ],
    unlockKey: 'guild:ritual-hunt-tools',
    rewardXp: 100,
  },
  'scout-network': {
    version: 1,
    title: 'Sieć zwiadowców',
    stages: [
      { key: 'routes', target: 80, contributionKinds: ['REGION', 'ACTIVITY'] },
      { key: 'reports', target: 40, contributionKinds: ['CHOICE', 'PVP_OBJECTIVE'] },
    ],
    unlockKey: 'guild:regional-scouting',
    rewardXp: 75,
  },
} as const;

type Transaction = Prisma.TransactionClient;

import { SocialCommunityService } from './social.service.community.js';
import { SocialGuildProgressService } from './social.service.guild-progress.js';

export abstract class SocialGuildService extends SocialGuildProgressService {
  async depositBank(
    session: PlayerSession,
    input: SocialBankDepositPayload,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.permissions.require(actor, 'BANK_DEPOSIT');
    const requestHash = this.hash(input);
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      const currentActor = await this.currentGuildActor(tx, actor);
      await this.permissions.requireForRole(
        currentActor.guildId,
        currentActor.role,
        'BANK_DEPOSIT',
        tx,
      );
      const replay = await this.claimBankOperation(
        tx,
        currentActor,
        input.operationId,
        'DEPOSIT',
        requestHash,
      );
      if (replay) return;
      await this.lockInventoryItem(tx, input.inventoryItemId);
      const item = await tx.inventoryItem.findUnique({
        where: { id: input.inventoryItemId },
        include: { itemDefinition: true, tradeOfferItems: { select: { id: true }, take: 1 } },
      });
      if (
        !item ||
        item.characterId !== session.characterId ||
        item.equippedSlot ||
        item.tradeOfferItems.length > 0 ||
        item.quantity < input.quantity
      ) {
        throw this.socialError('SOCIAL_BANK_ITEM_INVALID');
      }
      const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
      if (metadata.category === 'QUEST') throw this.socialError('SOCIAL_BANK_ITEM_INVALID');
      const snapshot = readItemInstanceSnapshot({
        instanceData: item.instanceData,
        definitionKey: item.itemDefinition.key,
        metadata,
      });
      const instanceHash = itemSnapshotHash(snapshot);
      if (input.quantity === item.quantity) {
        await tx.inventoryItem.delete({ where: { id: item.id } });
      } else {
        await tx.inventoryItem.update({
          where: { id: item.id },
          data: { quantity: { decrement: input.quantity } },
        });
      }
      const lockedProjectKey = input.projectKey ?? '';
      await tx.guildBankItem.upsert({
        where: {
          guildId_tabKey_itemDefinitionId_instanceHash_lockedProjectKey: {
            guildId: actor.guildId,
            tabKey: input.tabKey,
            itemDefinitionId: item.itemDefinitionId,
            instanceHash,
            lockedProjectKey,
          },
        },
        create: {
          guildId: actor.guildId,
          tabKey: input.tabKey,
          itemDefinitionId: item.itemDefinitionId,
          itemDefinitionKey: item.itemDefinition.key,
          itemName: item.itemDefinition.name,
          instanceHash,
          instanceData: socialJson(item.instanceData),
          quantity: input.quantity,
          lockedProjectKey,
        },
        update: { quantity: { increment: input.quantity }, revision: { increment: 1 } },
      });
      await tx.guildBankAudit.create({
        data: {
          guildId: actor.guildId,
          operationId: input.operationId,
          actorCharacterId: session.characterId,
          action: 'DEPOSIT',
          itemDefinitionId: item.itemDefinitionId,
          itemDefinitionKey: item.itemDefinition.key,
          quantity: input.quantity,
          metadata: socialJson({ tabKey: input.tabKey, lockedProjectKey }),
        },
      });
      await this.completeBankOperation(tx, actor.guildId, input.operationId, {
        depositedQuantity: input.quantity,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.dashboard(session);
  }

  async withdrawBank(
    session: PlayerSession,
    input: SocialBankWithdrawPayload,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.permissions.require(actor, 'BANK_WITHDRAW');
    const requestHash = this.hash(input);
    await this.prisma.$transaction(async (tx) => {
      await this.lockGuild(tx, actor.guildId);
      const currentActor = await this.currentGuildActor(tx, actor);
      await this.permissions.requireForRole(
        currentActor.guildId,
        currentActor.role,
        'BANK_WITHDRAW',
        tx,
      );
      const replay = await this.claimBankOperation(
        tx,
        currentActor,
        input.operationId,
        'WITHDRAW',
        requestHash,
      );
      if (replay) return;
      await this.lockBankItem(tx, input.bankItemId);
      const bankItem = await tx.guildBankItem.findUnique({ where: { id: input.bankItemId } });
      if (
        !bankItem ||
        bankItem.guildId !== actor.guildId ||
        bankItem.quantity < input.quantity ||
        bankItem.lockedProjectKey !== ''
      ) {
        throw this.socialError('SOCIAL_BANK_ITEM_INVALID');
      }
      const dayKey = new Date().toISOString().slice(0, 10);
      await tx.guildBankDailyUsage.upsert({
        where: {
          guildId_characterId_dayKey: {
            guildId: actor.guildId,
            characterId: session.characterId,
            dayKey,
          },
        },
        create: { guildId: actor.guildId, characterId: session.characterId, dayKey },
        update: {},
      });
      const usageRows = await tx.$queryRaw<Array<{ withdrawnQuantity: number }>>(Prisma.sql`
        SELECT "withdrawnQuantity" FROM "GuildBankDailyUsage"
        WHERE "guildId" = ${actor.guildId}::uuid
          AND "characterId" = ${session.characterId}::uuid
          AND "dayKey" = ${dayKey}
        FOR UPDATE
      `);
      const used = usageRows[0]?.withdrawnQuantity ?? 0;
      const limit = BANK_WITHDRAW_DAILY_LIMIT[currentActor.role];
      if (used + input.quantity > limit) throw this.socialError('SOCIAL_BANK_DAILY_LIMIT');
      const definition = await tx.itemDefinition.findUnique({
        where: { id: bankItem.itemDefinitionId },
      });
      if (!definition) throw this.socialError('SOCIAL_BANK_ITEM_INVALID');
      const metadata = parseItemDefinitionMetadata(definition.metadata);
      const snapshot = readItemInstanceSnapshot({
        instanceData: bankItem.instanceData,
        definitionKey: definition.key,
        metadata,
      });
      const grant = await this.items.grant(tx, {
        characterId: session.characterId,
        definition,
        quantity: input.quantity,
        snapshot,
        operationId: `guild-bank:${actor.guildId}:${input.operationId}`,
        reason: 'GUILD_BANK_WITHDRAW',
        claimOverflow: false,
      });
      if (input.quantity === bankItem.quantity) {
        await tx.guildBankItem.delete({ where: { id: bankItem.id } });
      } else {
        await tx.guildBankItem.update({
          where: { id: bankItem.id },
          data: { quantity: { decrement: input.quantity }, revision: { increment: 1 } },
        });
      }
      await tx.guildBankDailyUsage.update({
        where: {
          guildId_characterId_dayKey: {
            guildId: actor.guildId,
            characterId: session.characterId,
            dayKey,
          },
        },
        data: { withdrawnQuantity: { increment: input.quantity } },
      });
      await tx.guildBankAudit.create({
        data: {
          guildId: actor.guildId,
          operationId: input.operationId,
          actorCharacterId: session.characterId,
          action: 'WITHDRAW',
          itemDefinitionId: definition.id,
          itemDefinitionKey: definition.key,
          quantity: input.quantity,
          metadata: socialJson({
            dayKey,
            dailyUsedAfter: used + input.quantity,
            dailyLimit: limit,
            inventoryItemIds: grant.inventoryItemIds,
          }),
        },
      });
      await this.completeBankOperation(tx, actor.guildId, input.operationId, {
        withdrawnQuantity: input.quantity,
        inventoryItemIds: grant.inventoryItemIds,
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return this.dashboard(session);
  }

  async createAnnouncement(
    session: PlayerSession,
    input: SocialAnnouncementCreatePayload,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.permissions.require(actor, 'ANNOUNCEMENT_MANAGE');
    await this.mutateGuild(actor, input.operationId, 'ANNOUNCEMENT_CREATE', input, 'ANNOUNCEMENT_MANAGE', (state, now) => {
      state.announcements.unshift({
        id: randomUUID(),
        title: input.title,
        body: input.body,
        authorCharacterId: session.characterId,
        createdAt: now,
        pinned: input.pinned,
      });
      state.announcements = state.announcements
        .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.createdAt.localeCompare(left.createdAt))
        .slice(0, 50);
      return { created: true };
    });
    return this.dashboard(session);
  }

  async createEvent(
    session: PlayerSession,
    input: SocialEventCreatePayload,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.permissions.require(actor, 'EVENT_MANAGE');
    const startsAt = new Date(input.startsAt);
    if (startsAt.getTime() <= Date.now() - 60_000) throw this.socialError('SOCIAL_EVENT_INVALID');
    await this.mutateGuild(actor, input.operationId, 'EVENT_CREATE', input, 'EVENT_MANAGE', (state, now) => {
      state.events.push({
        id: randomUUID(),
        title: input.title,
        startsAt: startsAt.toISOString(),
        durationMinutes: input.durationMinutes,
        ...(input.activityKey ? { activityKey: input.activityKey } : {}),
        authorCharacterId: session.characterId,
        createdAt: now,
        rsvp: {},
      });
      state.events = state.events
        .filter((event) => new Date(event.startsAt).getTime() + event.durationMinutes * 60_000 > Date.now() - 24 * 60 * 60_000)
        .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
        .slice(0, 100);
      return { created: true };
    });
    return this.dashboard(session);
  }

  async rsvpEvent(
    session: PlayerSession,
    operationId: string,
    eventId: string,
    response: 'YES' | 'MAYBE' | 'NO',
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.mutateGuild(actor, operationId, 'EVENT_RSVP', { eventId, response }, undefined, (state) => {
      const event = state.events.find((candidate) => candidate.id === eventId);
      if (!event) throw this.socialError('SOCIAL_EVENT_INVALID');
      event.rsvp[session.characterId] = response;
      return { response };
    });
    return this.dashboard(session);
  }

}
