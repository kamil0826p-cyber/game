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
import { SocialFinderListingService } from './social.service.finder-listing.js';

export abstract class SocialFinderService extends SocialFinderListingService {
  async respondFinder(
    session: PlayerSession,
    input: SocialFinderRespondPayload,
  ): Promise<SocialDashboardView> {
    if (input.accept && await this.isCharacterBlocked(session.characterId, input.targetCharacterId)) {
      throw this.socialError('SOCIAL_BLOCKED');
    }
    await this.mutateRealm(
      session,
      input.operationId,
      'FINDER_RESPOND',
      input,
      async (state, now, tx) => {
        const listing = this.listing(state, input.listingId);
        if (listing.ownerCharacterId !== session.characterId) throw this.socialError('SOCIAL_FORBIDDEN');
        if (!['OPEN', 'LOBBY'].includes(listing.status)) throw this.socialError('SOCIAL_LISTING_CLOSED');
        const applicant = listing.applicants.find(
          (candidate) => candidate.characterId === input.targetCharacterId,
        );
        if (!applicant) throw this.socialError('SOCIAL_APPLICANT_NOT_FOUND');
        if (input.accept && await tx.socialBlock.findFirst({
          where: {
            OR: [
              { blockerCharacterId: session.characterId, blockedCharacterId: input.targetCharacterId },
              { blockerCharacterId: input.targetCharacterId, blockedCharacterId: session.characterId },
            ],
          },
          select: { blockerCharacterId: true },
        })) {
          throw this.socialError('SOCIAL_BLOCKED');
        }
        listing.applicants = listing.applicants.filter(
          (candidate) => candidate.characterId !== input.targetCharacterId,
        );
        if (input.accept) {
          if (listing.members.length >= listing.maximumSize) throw this.socialError('SOCIAL_PARTY_OVERFLOW');
          listing.members.push(this.memberFromApplicant(applicant));
          listing.status = 'LOBBY';
          state.metrics.acceptedApplications += 1;
        }
        listing.updatedAt = now;
        listing.revision += 1;
        return { accepted: input.accept };
      },
    );
    await this.publishCharacters([input.targetCharacterId]);
    return this.dashboard(session);
  }

  async readyFinder(
    session: PlayerSession,
    input: SocialFinderReadyPayload,
  ): Promise<SocialDashboardView> {
    const listingRecord = await this.prisma.socialRealmState.findUnique({ where: { realmId: session.realmId } });
    const listing = listingRecord
      ? parseSocialRealmState(listingRecord.state).listings[input.listingId]
      : undefined;
    if (!listing) throw this.socialError('SOCIAL_LISTING_NOT_FOUND');
    const requirementsMet = await this.requirementsMet(
      session.characterId,
      session.level,
      listing.requirements,
    );
    await this.mutateRealm(
      session,
      input.operationId,
      'FINDER_READY',
      input,
      (state, now) => {
        const current = this.listing(state, input.listingId);
        state.listings[input.listingId] = this.domain(() => updateFinderReadiness(
          current,
          session.characterId,
          {
            functions: input.functions,
            formation: input.formation,
            loadoutReady: input.loadoutReady,
            requirementsMet,
            riskAccepted: input.riskAccepted,
            consumableSummary: input.consumableSummary,
          },
          now,
        ));
        return { requirementsMet };
      },
    );
    return this.dashboard(session);
  }

  async startFinder(
    session: PlayerSession,
    operationId: string,
    listingId: string,
  ): Promise<SocialDashboardView> {
    let affected: string[] = [];
    await this.mutateRealm(
      session,
      operationId,
      'FINDER_START',
      { listingId },
      (state, now) => {
        const listing = this.listing(state, listingId);
        if (listing.ownerCharacterId !== session.characterId) throw this.socialError('SOCIAL_FORBIDDEN');
        const frozen = this.domain(() => freezeFinderListing(listing, now));
        this.groups.assembleFinderRoster(session, frozen.frozenCharacterIds);
        frozen.status = 'STARTED';
        frozen.revision += 1;
        frozen.updatedAt = now;
        state.listings[listingId] = frozen;
        state.metrics.listingsStarted += 1;
        affected = [...frozen.frozenCharacterIds];
        return { frozenCharacterIds: affected };
      },
    );
    await this.publishCharacters(affected);
    return this.dashboard(session);
  }

  async cancelFinder(
    session: PlayerSession,
    operationId: string,
    listingId: string,
  ): Promise<SocialDashboardView> {
    await this.mutateRealm(
      session,
      operationId,
      'FINDER_CANCEL',
      { listingId },
      (state, now) => {
        const listing = this.listing(state, listingId);
        if (listing.ownerCharacterId !== session.characterId) throw this.socialError('SOCIAL_FORBIDDEN');
        if (listing.status === 'STARTED' || listing.status === 'COMPLETED') {
          throw this.socialError('SOCIAL_LISTING_CLOSED');
        }
        if (listing.status !== 'CANCELLED') state.metrics.lobbyDropoffs += 1;
        listing.status = 'CANCELLED';
        listing.updatedAt = now;
        listing.revision += 1;
        return { cancelled: true };
      },
    );
    return this.dashboard(session);
  }

}
