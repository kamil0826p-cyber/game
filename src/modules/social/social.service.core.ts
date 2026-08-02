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
import {
  GuildPermissionService,
  type GuildPermissionActor,
} from '../guilds/guild-permission.service.js';
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

const socialJson = (value: unknown): Prisma.InputJsonValue =>
  value as Prisma.InputJsonValue;
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

export abstract class SocialServiceCore {
  constructor(
    protected readonly prisma: PrismaService,
    protected readonly groups: GroupService,
    protected readonly items: ItemInventoryService,
    protected readonly permissions: GuildPermissionService,
    protected readonly world: WorldStateService,
    protected readonly publisher: WorldEventsPublisher,
  ) {}

  protected async mutateRealm<TResult>(
    session: PlayerSession,
    operationId: string,
    kind: string,
    request: unknown,
    mutate: (
      state: SocialRealmState,
      now: string,
      tx: Transaction,
    ) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    this.assertOperationId(operationId);
    const requestHash = this.hash(request);
    return this.prisma.$transaction(
      async (tx) => {
        await tx.socialRealmState.upsert({
          where: { realmId: session.realmId },
          create: {
            realmId: session.realmId,
            state: socialJson(emptySocialRealmState()),
          },
          update: {},
        });
        await tx.$queryRaw(Prisma.sql`
          SELECT "realmId" FROM "SocialRealmState"
          WHERE "realmId" = ${session.realmId}::uuid FOR UPDATE
        `);
        const record = await tx.socialRealmState.findUniqueOrThrow({
          where: { realmId: session.realmId },
        });
        const state = parseSocialRealmState(record.state);
        const operationKey = `${session.characterId}:${operationId}`;
        const existing = state.operations[operationKey];
        if (existing) {
          this.assertReplay(existing, kind, requestHash);
          return existing.result as TResult;
        }
        const now = new Date().toISOString();
        const result = await mutate(state, now, tx);
        state.operations[operationKey] = {
          kind,
          requestHash,
          result,
          completedAt: now,
        };
        this.trimOperations(state.operations);
        await tx.socialRealmState.update({
          where: { realmId: session.realmId },
          data: { state: socialJson(state), revision: { increment: 1 } },
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  protected async mutateGuild<TResult>(
    actor: GuildPermissionActor,
    operationId: string,
    kind: string,
    request: unknown,
    requiredPermission: GuildSocialPermission | undefined,
    mutate: (
      state: GuildSocialState,
      now: string,
      tx: Transaction,
    ) => TResult | Promise<TResult>,
  ): Promise<TResult> {
    this.assertOperationId(operationId);
    const requestHash = this.hash(request);
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockGuild(tx, actor.guildId);
        const currentActor = await this.currentGuildActor(tx, actor);
        if (requiredPermission) {
          await this.permissions.requireForRole(
            currentActor.guildId,
            currentActor.role,
            requiredPermission,
            tx,
          );
        }
        await tx.guildSocialState.upsert({
          where: { guildId: actor.guildId },
          create: {
            guildId: actor.guildId,
            state: socialJson(emptyGuildSocialState()),
          },
          update: {},
        });
        await tx.$queryRaw(Prisma.sql`
          SELECT "guildId" FROM "GuildSocialState"
          WHERE "guildId" = ${actor.guildId}::uuid FOR UPDATE
        `);
        const record = await tx.guildSocialState.findUniqueOrThrow({
          where: { guildId: actor.guildId },
        });
        const state = parseGuildSocialState(record.state);
        const operationKey = `${actor.characterId}:${operationId}`;
        const existing = state.operations[operationKey];
        if (existing) {
          this.assertReplay(existing, kind, requestHash);
          return existing.result as TResult;
        }
        const now = new Date().toISOString();
        const result = await mutate(state, now, tx);
        state.operations[operationKey] = {
          kind,
          requestHash,
          result,
          completedAt: now,
        };
        this.trimOperations(state.operations);
        await tx.guildSocialState.update({
          where: { guildId: actor.guildId },
          data: { state: socialJson(state), revision: { increment: 1 } },
        });
        return result;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  protected async requirementsMet(
    characterId: string,
    level: number,
    requirements: FinderListingState['requirements'],
  ): Promise<boolean> {
    if (requirements.minimumLevel && level < requirements.minimumLevel) return false;
    if (requirements.maximumLevel && level > requirements.maximumLevel) return false;
    const itemKeys = requirements.requiredItemKeys ?? [];
    if (itemKeys.length > 0) {
      const items = await this.prisma.inventoryItem.findMany({
        where: {
          characterId,
          itemDefinition: { key: { in: itemKeys } },
        },
        select: { itemDefinition: { select: { key: true } } },
      });
      const owned = new Set(items.map((item) => item.itemDefinition.key));
      if (itemKeys.some((key) => !owned.has(key))) return false;
    }
    if ((requirements.requiredFlagKeys?.length ?? 0) > 0) {
      const character = await this.prisma.character.findUnique({
        where: { id: characterId },
        select: { progressionData: true },
      });
      const raw = character?.progressionData;
      const progression =
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {};
      const narrative = progression.narrative;
      const flags =
        narrative && typeof narrative === 'object' && !Array.isArray(narrative)
          ? (narrative as Record<string, unknown>).flags
          : undefined;
      const values =
        flags && typeof flags === 'object' && !Array.isArray(flags)
          ? (flags as Record<string, unknown>)
          : {};
      if (requirements.requiredFlagKeys!.some((key) => values[key] !== true)) {
        return false;
      }
    }
    return true;
  }

  protected listing(state: SocialRealmState, listingId: string): FinderListingState {
    const listing = state.listings[listingId];
    if (!listing) throw this.socialError('SOCIAL_LISTING_NOT_FOUND');
    return listing;
  }

  protected mentorship(
    state: SocialRealmState,
    mentorshipId: string,
    actorCharacterId: string,
  ): MentorshipState {
    const mentorship = state.mentorships[mentorshipId];
    if (
      !mentorship ||
      ![mentorship.mentorCharacterId, mentorship.learnerCharacterId].includes(
        actorCharacterId,
      )
    ) {
      throw this.socialError('SOCIAL_MENTOR_INVALID');
    }
    return mentorship;
  }

  protected memberFromApplicant(applicant: FinderApplicantState): FinderMemberState {
    return {
      characterId: applicant.characterId,
      userId: applicant.userId,
      name: applicant.name,
      level: applicant.level,
      characterClass: applicant.characterClass,
      functions: applicant.functions,
      formation: 'BACK',
      loadoutReady: false,
      requirementsMet: false,
      riskAccepted: false,
      consumableSummary: [],
      reconnectStatus: 'ONLINE',
    };
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

  protected async lockGuild(tx: Transaction, guildId: string): Promise<void> {
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM "Guild" WHERE "id" = ${guildId}::uuid FOR UPDATE
    `);
    if (rows.length !== 1) throw this.socialError('SOCIAL_FORBIDDEN');
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

  protected trimOperations(
    operations: Record<string, ProcessedSocialOperation>,
  ): void {
    const entries = Object.entries(operations);
    if (entries.length <= 2_000) return;
    entries
      .sort((left, right) =>
        left[1].completedAt.localeCompare(right[1].completedAt),
      )
      .slice(0, entries.length - 2_000)
      .forEach(([key]) => delete operations[key]);
  }

  protected assertOperationId(operationId: string): void {
    if (!operationPattern.test(operationId)) {
      throw this.socialError('SOCIAL_OPERATION_INVALID');
    }
  }

  protected hash(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }

  protected socialError(reason: string): GameError {
    return new GameError(GAME_ERROR_CODES.INVALID_PAYLOAD, 'errors.payload.invalid', {
      reason,
    });
  }

  protected async dashboard(_session: PlayerSession): Promise<SocialDashboardView> {
    throw this.socialError('SOCIAL_DASHBOARD_NOT_IMPLEMENTED');
  }
}
