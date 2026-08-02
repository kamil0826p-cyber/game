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

import { SocialServiceBase } from './social.service.base.js';

export abstract class SocialFinderListingService extends SocialServiceBase {
  async dashboard(session: PlayerSession): Promise<SocialDashboardView> {
    const [realmRecord, blocks, membership] = await Promise.all([
      this.prisma.socialRealmState.findUnique({ where: { realmId: session.realmId } }),
      this.prisma.socialBlock.findMany({
        where: {
          OR: [
            { blockerCharacterId: session.characterId },
            { blockedCharacterId: session.characterId },
          ],
        },
      }),
      this.prisma.guildMember.findUnique({ where: { characterId: session.characterId } }),
    ]);
    const realm = realmRecord
      ? parseSocialRealmState(realmRecord.state)
      : emptySocialRealmState();
    const blocked = new Set(
      blocks.map((block) =>
        block.blockerCharacterId === session.characterId
          ? block.blockedCharacterId
          : block.blockerCharacterId,
      ),
    );
    const visibleListings = Object.values(realm.listings)
      .filter((listing) => ACTIVE_LISTING_STATUSES.has(listing.status))
      .filter((listing) => !blocked.has(listing.ownerCharacterId))
      .filter((listing) => !listing.members.some((member) => blocked.has(member.characterId)))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    const ownListing = visibleListings.find((listing) =>
      listing.members.some((member) => member.characterId === session.characterId),
    );

    const result: SocialDashboardView = {
      listings: visibleListings,
      ...(ownListing ? { ownListing } : {}),
      recentPlayers: (realm.recentByCharacter[session.characterId] ?? []).filter(
        (entry) => !blocked.has(entry.characterId),
      ),
      contacts: (realm.contactsByCharacter[session.characterId] ?? []).filter(
        (characterId) => !blocked.has(characterId),
      ),
      blockedCharacterIds: [...blocked],
      ...(realm.mentorProfiles[session.characterId]
        ? { mentorProfile: realm.mentorProfiles[session.characterId] }
        : {}),
      activeMentorships: Object.values(realm.mentorships).filter(
        (mentorship) =>
          mentorship.status === 'ACTIVE' &&
          (mentorship.mentorCharacterId === session.characterId ||
            mentorship.learnerCharacterId === session.characterId),
      ),
      regionGoals: Object.values(realm.regionGoals),
      metrics: {
        fillRate: metricFillRate(realm.metrics),
        lobbyDropoffRate: metricLobbyDropoffRate(realm.metrics),
        mentoringCompletionRate: metricMentoringCompletionRate(realm.metrics),
        rewardConcentration: rewardConcentration(realm.metrics.rewardByGuild),
      },
    };

    if (membership) {
      const actor: GuildPermissionActor = {
        guildId: membership.guildId,
        characterId: session.characterId,
        role: membership.role,
      };
      const [stateRecord, guild, bank, bankAudit, allowed] = await Promise.all([
        this.prisma.guildSocialState.findUnique({ where: { guildId: membership.guildId } }),
        this.prisma.guild.findUnique({
          where: { id: membership.guildId },
          select: { level: true, experience: true },
        }),
        this.prisma.guildBankItem.findMany({
          where: { guildId: membership.guildId },
          orderBy: [{ tabKey: 'asc' }, { updatedAt: 'desc' }],
          take: 200,
        }),
        this.prisma.guildBankAudit.findMany({
          where: { guildId: membership.guildId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        }),
        this.permissions.permissions(actor),
      ]);
      const state = stateRecord
        ? parseGuildSocialState(stateRecord.state)
        : emptyGuildSocialState();
      result.guild = {
        guildId: membership.guildId,
        permissions: allowed,
        contracts: Object.values(state.contracts),
        projects: Object.values(state.projects),
        unlockKeys: state.unlockKeys,
        announcements: state.announcements,
        events: state.events,
        bank: bank.map((item) => this.bankItemView(item)),
        bankAudit: allowed.includes('BANK_AUDIT')
          ? bankAudit.map((audit) => this.bankAuditView(audit))
          : [],
        level: guild?.level ?? 1,
        experience: guild?.experience ?? 0,
      };
    }
    return result;
  }

  async createFinder(
    session: PlayerSession,
    input: SocialFinderCreatePayload,
  ): Promise<SocialDashboardView> {
    this.domain(() => {
      assertFinderPartySize(input.minimumSize, input.maximumSize);
      assertStableActivityKey(input.activityKey);
    });
    const roster = this.groups.getActivityRoster(session);
    if (roster.length > input.maximumSize) {
      throw this.socialError('SOCIAL_PARTY_OVERFLOW');
    }
    const requirementResults = await Promise.all(
      roster.map((member) => this.requirementsMet(member.characterId, member.level, input.requirements)),
    );
    await this.mutateRealm(
      session,
      input.operationId,
      'FINDER_CREATE',
      input,
      (state, now) => {
        const collision = Object.values(state.listings).some(
          (listing) =>
            ACTIVE_LISTING_STATUSES.has(listing.status) &&
            listing.members.some((member) =>
              roster.some((candidate) => candidate.characterId === member.characterId),
            ),
        );
        if (collision) throw this.socialError('SOCIAL_ALREADY_LISTED');
        const listingId = randomUUID();
        const members = roster.map<FinderMemberState>((member, index) => ({
          characterId: member.characterId,
          userId: member.userId,
          name: member.name,
          level: member.level,
          characterClass: member.characterClass,
          functions: [],
          formation: index === 0 ? 'FRONT' : 'BACK',
          loadoutReady: false,
          requirementsMet: requirementResults[index] ?? false,
          riskAccepted: false,
          consumableSummary: [],
          reconnectStatus: 'ONLINE',
        }));
        state.listings[listingId] = {
          id: listingId,
          ownerCharacterId: session.characterId,
          realmId: session.realmId,
          activityType: input.activityType,
          activityKey: input.activityKey,
          title: input.title,
          minimumSize: input.minimumSize,
          maximumSize: input.maximumSize,
          levelHint: input.levelHint,
          requestedFunctions: [...new Set(input.requestedFunctions)],
          language: input.language,
          expectedMinutes: input.expectedMinutes,
          riskProfile: input.riskProfile,
          requirements: input.requirements,
          acceptancePolicy: input.acceptancePolicy,
          decisionPolicy: input.decisionPolicy,
          status: 'LOBBY',
          members,
          applicants: [],
          frozenCharacterIds: [],
          createdAt: now,
          updatedAt: now,
          revision: 0,
        };
        state.metrics.listingsCreated += 1;
        return { listingId };
      },
    );
    await this.publishCharacters(roster.map((member) => member.characterId));
    return this.dashboard(session);
  }

  async applyFinder(
    session: PlayerSession,
    input: SocialFinderApplyPayload,
  ): Promise<SocialDashboardView> {
    const blocked = await this.isBlocked(session.realmId, session.characterId, input.listingId);
    if (blocked) throw this.socialError('SOCIAL_BLOCKED');
    await this.mutateRealm(
      session,
      input.operationId,
      'FINDER_APPLY',
      input,
      async (state, now, tx) => {
        const listing = this.listing(state, input.listingId);
        if (!['OPEN', 'LOBBY'].includes(listing.status)) {
          throw this.socialError('SOCIAL_LISTING_CLOSED');
        }
        if (listing.realmId !== session.realmId) throw this.socialError('SOCIAL_LISTING_CLOSED');
        const memberIds = [...new Set(listing.members.map((member) => member.characterId))]
          .filter((characterId) => characterId !== session.characterId);
        if (memberIds.length > 0 && await tx.socialBlock.findFirst({
          where: {
            OR: [
              { blockerCharacterId: session.characterId, blockedCharacterId: { in: memberIds } },
              { blockerCharacterId: { in: memberIds }, blockedCharacterId: session.characterId },
            ],
          },
          select: { blockerCharacterId: true },
        })) {
          throw this.socialError('SOCIAL_BLOCKED');
        }
        if (listing.members.some((member) => member.characterId === session.characterId)) {
          return { accepted: true };
        }
        if (listing.applicants.some((applicant) => applicant.characterId === session.characterId)) {
          return { accepted: false };
        }
        if (listing.members.length >= listing.maximumSize) throw this.socialError('SOCIAL_PARTY_OVERFLOW');
        const applicant: FinderApplicantState = {
          characterId: session.characterId,
          userId: session.userId,
          name: session.name,
          level: session.level,
          characterClass: session.characterClass,
          functions: [...new Set(input.functions)],
          appliedAt: now,
        };
        state.metrics.applications += 1;
        if (listing.acceptancePolicy === 'AUTO') {
          listing.members.push(this.memberFromApplicant(applicant));
          listing.status = 'LOBBY';
          state.metrics.acceptedApplications += 1;
          listing.updatedAt = now;
          listing.revision += 1;
          return { accepted: true };
        }
        listing.applicants.push(applicant);
        listing.updatedAt = now;
        listing.revision += 1;
        return { accepted: false };
      },
    );
    return this.dashboard(session);
  }

}
