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


import { SocialServiceCore } from './social.service.core.js';

export abstract class SocialServiceBase extends SocialServiceCore {
  protected async isBlocked(
    realmId: string,
    actorCharacterId: string,
    listingId: string,
  ): Promise<boolean> {
    const record = await this.prisma.socialRealmState.findUnique({ where: { realmId } });
    const listing = record ? parseSocialRealmState(record.state).listings[listingId] : undefined;
    if (!listing) return false;
    const memberIds = [...new Set(listing.members.map((member) => member.characterId))]
      .filter((characterId) => characterId !== actorCharacterId);
    if (memberIds.length === 0) return false;
    return Boolean(await this.prisma.socialBlock.findFirst({
      where: {
        OR: [
          { blockerCharacterId: actorCharacterId, blockedCharacterId: { in: memberIds } },
          { blockerCharacterId: { in: memberIds }, blockedCharacterId: actorCharacterId },
        ],
      },
      select: { blockerCharacterId: true },
    }));
  }

  protected async isCharacterBlocked(left: string, right: string): Promise<boolean> {
    return Boolean(await this.prisma.socialBlock.findFirst({
      where: {
        OR: [
          { blockerCharacterId: left, blockedCharacterId: right },
          { blockerCharacterId: right, blockedCharacterId: left },
        ],
      },
      select: { blockerCharacterId: true },
    }));
  }

  protected async assertSameRealmTarget(session: PlayerSession, targetCharacterId: string): Promise<void> {
    const target = await this.character(targetCharacterId);
    if (target.realmId !== session.realmId) throw this.socialError('SOCIAL_TARGET_UNAVAILABLE');
  }

  protected async character(characterId: string): Promise<{
    id: string;
    userId: string;
    realmId: string;
    name: string;
  }> {
    const character = await this.prisma.character.findUnique({
      where: { id: characterId },
      select: { id: true, userId: true, realmId: true, name: true },
    });
    if (!character) throw this.socialError('SOCIAL_TARGET_UNAVAILABLE');
    return character;
  }

  protected async currentGuildActor(
    tx: Transaction,
    actor: GuildPermissionActor,
  ): Promise<GuildPermissionActor> {
    const membership = await tx.guildMember.findUnique({
      where: { characterId: actor.characterId },
    });
    if (!membership || membership.guildId !== actor.guildId) {
      throw new GameError(GAME_ERROR_CODES.GUILD_REQUIRED, 'errors.guild.required');
    }
    return {
      guildId: membership.guildId,
      characterId: actor.characterId,
      role: membership.role,
    };
  }

  protected async grantGuildXp(tx: Transaction, guildId: string, amount: number): Promise<void> {
    const guild = await tx.guild.update({
      where: { id: guildId },
      data: { experience: { increment: amount } },
      select: { experience: true, level: true },
    });
    const nextLevel = Math.min(20, 1 + Math.floor(guild.experience / 250));
    if (nextLevel !== guild.level) {
      await tx.guild.update({ where: { id: guildId }, data: { level: nextLevel } });
    }
  }

  protected async addGuildRewardMetric(
    session: PlayerSession,
    guildId: string,
    sourceOperationId: string,
    amount: number,
  ): Promise<void> {
    await this.mutateRealm(
      session,
      `guild-reward:${guildId}:${sourceOperationId}`,
      'GUILD_REWARD_METRIC',
      { guildId, amount },
      (state) => {
        state.metrics.rewardByGuild[guildId] =
          (state.metrics.rewardByGuild[guildId] ?? 0) + amount;
        return { recorded: true };
      },
    );
  }

  protected async claimBankOperation(
    tx: Transaction,
    actor: GuildPermissionActor,
    operationId: string,
    operationType: string,
    requestHash: string,
  ): Promise<unknown | undefined> {
    this.assertOperationId(operationId);
    const existing = await tx.guildBankOperation.findUnique({
      where: { guildId_operationId: { guildId: actor.guildId, operationId } },
    });
    if (existing) {
      if (existing.operationType !== operationType || existing.requestHash !== requestHash) {
        throw this.socialError('SOCIAL_OPERATION_COLLISION');
      }
      if (existing.status === 'COMPLETED') return existing.result;
      throw this.socialError('SOCIAL_OPERATION_IN_PROGRESS');
    }
    await tx.guildBankOperation.create({
      data: {
        guildId: actor.guildId,
        operationId,
        actorCharacterId: actor.characterId,
        operationType,
        requestHash,
        status: 'PENDING',
      },
    });
    return undefined;
  }

  protected async completeBankOperation(
    tx: Transaction,
    guildId: string,
    operationId: string,
    result: unknown,
  ): Promise<void> {
    await tx.guildBankOperation.update({
      where: { guildId_operationId: { guildId, operationId } },
      data: { status: 'COMPLETED', result: socialJson(result), completedAt: new Date() },
    });
  }

  protected async claimStandaloneOperation(
    tx: Transaction,
    session: PlayerSession,
    operationId: string,
    kind: string,
    requestHash: string,
  ): Promise<void> {
    this.assertOperationId(operationId);
    await tx.socialRealmState.upsert({
      where: { realmId: session.realmId },
      create: { realmId: session.realmId, state: socialJson(emptySocialRealmState()) },
      update: {},
    });
    await tx.$queryRaw(Prisma.sql`
      SELECT "realmId" FROM "SocialRealmState"
      WHERE "realmId" = ${session.realmId}::uuid FOR UPDATE
    `);
    const record = await tx.socialRealmState.findUniqueOrThrow({ where: { realmId: session.realmId } });
    const state = parseSocialRealmState(record.state);
    const operationKey = `${session.characterId}:${operationId}`;
    const existing = state.operations[operationKey];
    if (existing) {
      this.assertReplay(existing, kind, requestHash);
      return;
    }
    state.operations[operationKey] = {
      kind,
      requestHash,
      result: { recorded: true },
      completedAt: new Date().toISOString(),
    };
    this.trimOperations(state.operations);
    await tx.socialRealmState.update({
      where: { realmId: session.realmId },
      data: { state: socialJson(state), revision: { increment: 1 } },
    });
  }

  protected async lockGuild(tx: Transaction, guildId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Guild" WHERE "id" = ${guildId}::uuid FOR UPDATE
    `);
    if (rows.length !== 1) throw this.socialError('SOCIAL_FORBIDDEN');
  }

  protected async lockInventoryItem(tx: Transaction, itemId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "InventoryItem" WHERE "id" = ${itemId}::uuid FOR UPDATE
    `);
  }

  protected async lockBankItem(tx: Transaction, itemId: string): Promise<void> {
    await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "GuildBankItem" WHERE "id" = ${itemId}::uuid FOR UPDATE
    `);
  }

  protected bankItemView(item: {
    id: string;
    tabKey: string;
    itemDefinitionKey: string;
    itemName: string;
    quantity: number;
    lockedProjectKey: string;
    revision: number;
  }): GuildBankItemView {
    return {
      id: item.id,
      tabKey: item.tabKey,
      itemDefinitionKey: item.itemDefinitionKey,
      itemName: item.itemName,
      quantity: item.quantity,
      ...(item.lockedProjectKey ? { lockedProjectKey: item.lockedProjectKey } : {}),
      revision: item.revision,
    };
  }

  protected bankAuditView(audit: {
    id: string;
    operationId: string;
    actorCharacterId: string;
    action: string;
    itemDefinitionKey: string | null;
    quantity: number;
    createdAt: Date;
  }): GuildBankAuditView {
    return {
      id: audit.id,
      operationId: audit.operationId,
      actorCharacterId: audit.actorCharacterId,
      action: audit.action,
      ...(audit.itemDefinitionKey ? { itemDefinitionKey: audit.itemDefinitionKey } : {}),
      quantity: audit.quantity,
      createdAt: audit.createdAt.toISOString(),
    };
  }

  protected async publishCharacters(characterIds: readonly string[]): Promise<void> {
    for (const characterId of new Set(characterIds)) {
      const session = this.world.getByCharacterId(characterId);
      if (!session?.activeInWorld) continue;
      this.publisher.emit(session.socketId, 'social:updated', await this.dashboard(session));
    }
  }

  protected assertReplay(
    existing: ProcessedSocialOperation,
    kind: string,
    requestHash: string,
  ): void {
    if (existing.kind !== kind || existing.requestHash !== requestHash) {
      throw this.socialError('SOCIAL_OPERATION_COLLISION');
    }
  }

  protected trimOperations(operations: Record<string, ProcessedSocialOperation>): void {
    const entries = Object.entries(operations);
    if (entries.length <= 2_000) return;
    entries
      .sort((left, right) => left[1].completedAt.localeCompare(right[1].completedAt))
      .slice(0, entries.length - 2_000)
      .forEach(([key]) => delete operations[key]);
  }

  protected assertOperationId(operationId: string): void {
    if (!operationPattern.test(operationId)) throw this.socialError('SOCIAL_OPERATION_INVALID');
  }

  protected hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  protected weekKey(date: Date): string {
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((utc.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
    return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }

  protected domain<TResult>(operation: () => TResult): TResult {
    try {
      return operation();
    } catch (error) {
      if (error instanceof GameError) throw error;
      throw this.socialError(error instanceof Error ? error.message : 'SOCIAL_DOMAIN_INVALID');
    }
  }

  protected socialError(reason: string): GameError {
    return new GameError(
      GAME_ERROR_CODES.INVALID_PAYLOAD,
      'errors.payload.invalid',
      { reason },
    );
  }
}
