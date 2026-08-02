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

import { SocialFinderService } from './social.service.finder.js';

export abstract class SocialCommunityService extends SocialFinderService {
  async completeActivity(
    session: PlayerSession,
    input: SocialActivityCompletePayload,
  ): Promise<SocialDashboardView> {
    await this.mutateRealm(
      session,
      input.operationId,
      'ACTIVITY_COMPLETE',
      input,
      (state, now) => {
        const listing = this.listing(state, input.listingId);
        if (!listing.frozenCharacterIds.includes(session.characterId)) {
          throw this.socialError('SOCIAL_FORBIDDEN');
        }
        if (listing.status === 'COMPLETED') return { completed: true };
        if (listing.status !== 'STARTED') throw this.socialError('SOCIAL_LISTING_CLOSED');
        const submitted = new Set(input.members.map((member) => member.characterId));
        if (
          submitted.size !== listing.frozenCharacterIds.length ||
          listing.frozenCharacterIds.some((characterId) => !submitted.has(characterId))
        ) {
          throw this.socialError('SOCIAL_ROSTER_CHANGED');
        }
        const byId = new Map(listing.members.map((member) => [member.characterId, member]));
        for (const participant of input.members) {
          if (participant.afk) state.metrics.afkFlags += 1;
          if (participant.disconnected) state.metrics.disconnects += 1;
          for (const peerId of listing.frozenCharacterIds) {
            if (peerId === participant.characterId) continue;
            const peer = byId.get(peerId);
            if (!peer) continue;
            const entries = state.recentByCharacter[participant.characterId] ?? [];
            state.recentByCharacter[participant.characterId] = appendRecentPlayer(entries, {
              characterId: peer.characterId,
              name: peer.name,
              activityKey: listing.activityKey,
              outcome: input.outcome,
              completedAt: now,
              finished: participant.finished,
              disconnected: participant.disconnected,
            });
          }
        }
        listing.status = 'COMPLETED';
        listing.updatedAt = now;
        listing.revision += 1;
        state.metrics.activitiesCompleted += 1;
        return { completed: true };
      },
    );
    return this.dashboard(session);
  }

  async addContact(
    session: PlayerSession,
    operationId: string,
    targetCharacterId: string,
  ): Promise<SocialDashboardView> {
    await this.assertSameRealmTarget(session, targetCharacterId);
    if (await this.isCharacterBlocked(session.characterId, targetCharacterId)) {
      throw this.socialError('SOCIAL_BLOCKED');
    }
    await this.mutateRealm(session, operationId, 'CONTACT_ADD', { targetCharacterId }, (state) => {
      const contacts = new Set(state.contactsByCharacter[session.characterId] ?? []);
      contacts.add(targetCharacterId);
      state.contactsByCharacter[session.characterId] = [...contacts].slice(-100);
      return { added: true };
    });
    return this.dashboard(session);
  }

  async setBlock(
    session: PlayerSession,
    operationId: string,
    targetCharacterId: string,
    blocked: boolean,
  ): Promise<SocialDashboardView> {
    if (targetCharacterId === session.characterId) throw this.socialError('SOCIAL_FORBIDDEN');
    await this.assertSameRealmTarget(session, targetCharacterId);
    const requestHash = this.hash({ targetCharacterId, blocked });
    await this.prisma.$transaction(async (tx) => {
      await this.claimStandaloneOperation(tx, session, operationId, 'BLOCK_SET', requestHash);
      if (blocked) {
        await tx.socialBlock.upsert({
          where: {
            blockerCharacterId_blockedCharacterId: {
              blockerCharacterId: session.characterId,
              blockedCharacterId: targetCharacterId,
            },
          },
          create: { blockerCharacterId: session.characterId, blockedCharacterId: targetCharacterId },
          update: {},
        });
      } else {
        await tx.socialBlock.deleteMany({
          where: { blockerCharacterId: session.characterId, blockedCharacterId: targetCharacterId },
        });
      }
    });
    return this.dashboard(session);
  }

  async setMentorProfile(
    session: PlayerSession,
    input: SocialMentorProfilePayload,
  ): Promise<SocialDashboardView> {
    await this.mutateRealm(session, input.operationId, 'MENTOR_PROFILE', input, (state, now) => {
      const current = state.mentorProfiles[session.characterId];
      const weekKey = this.weekKey(new Date(now));
      state.mentorProfiles[session.characterId] = {
        characterId: session.characterId,
        userId: session.userId,
        language: input.language,
        activityKeys: [...new Set(input.activityKeys)],
        active: input.active,
        reputation: current?.reputation ?? 0,
        weeklyCompleted: current?.weekKey === weekKey ? current.weeklyCompleted : 0,
        weekKey,
        updatedAt: now,
      };
      return { active: input.active };
    });
    return this.dashboard(session);
  }

  async startMentorship(
    session: PlayerSession,
    input: SocialMentorshipStartPayload,
  ): Promise<SocialDashboardView> {
    const [mentor, learner] = await Promise.all([
      this.character(input.mentorCharacterId),
      this.character(input.learnerCharacterId),
    ]);
    if (
      mentor.realmId !== session.realmId ||
      learner.realmId !== session.realmId ||
      mentor.userId === learner.userId ||
      ![mentor.id, learner.id].includes(session.characterId)
    ) {
      throw this.socialError('SOCIAL_MENTOR_INVALID');
    }
    await this.mutateRealm(session, input.operationId, 'MENTORSHIP_START', input, (state, now) => {
      const profile = state.mentorProfiles[mentor.id];
      if (!profile?.active || !profile.activityKeys.includes(input.activityKey)) {
        throw this.socialError('SOCIAL_MENTOR_INVALID');
      }
      const duplicate = Object.values(state.mentorships).some(
        (mentorship) =>
          mentorship.status === 'ACTIVE' &&
          (mentorship.mentorCharacterId === mentor.id ||
            mentorship.learnerCharacterId === learner.id),
      );
      if (duplicate) throw this.socialError('SOCIAL_MENTOR_INVALID');
      const id = randomUUID();
      state.mentorships[id] = {
        id,
        mentorCharacterId: mentor.id,
        mentorUserId: mentor.userId,
        learnerCharacterId: learner.id,
        learnerUserId: learner.userId,
        activityKey: input.activityKey,
        startedAt: now,
        status: 'ACTIVE',
        qualifiedSteps: 0,
        afkSeconds: 0,
        rewardGranted: false,
      };
      return { mentorshipId: id };
    });
    return this.dashboard(session);
  }

  async recordMentorshipProgress(
    session: PlayerSession,
    input: SocialMentorshipProgressPayload,
  ): Promise<SocialDashboardView> {
    await this.mutateRealm(session, input.operationId, 'MENTORSHIP_PROGRESS', input, (state) => {
      const mentorship = this.mentorship(state, input.mentorshipId, session.characterId);
      mentorship.qualifiedSteps = Math.max(mentorship.qualifiedSteps, input.qualifiedSteps);
      mentorship.afkSeconds = Math.max(mentorship.afkSeconds, input.afkSeconds);
      return { recorded: true };
    });
    return this.dashboard(session);
  }

  async completeMentorship(
    session: PlayerSession,
    operationId: string,
    mentorshipId: string,
  ): Promise<SocialDashboardView> {
    await this.mutateRealm(
      session,
      operationId,
      'MENTORSHIP_COMPLETE',
      { mentorshipId },
      (state, now) => {
        const mentorship = this.mentorship(state, mentorshipId, session.characterId);
        const profile = state.mentorProfiles[mentorship.mentorCharacterId];
        if (!profile) throw this.socialError('SOCIAL_MENTOR_INVALID');
        const weekKey = this.weekKey(new Date(now));
        const weeklyCompleted = profile.weekKey === weekKey ? profile.weeklyCompleted : 0;
        if (!mentorshipCompletionAllowed(mentorship, weeklyCompleted)) {
          mentorship.status = 'FLAGGED';
          mentorship.completedAt = now;
          state.metrics.mentoringAbuseFlags += 1;
          return { rewardRejected: true };
        }
        mentorship.status = 'COMPLETED';
        mentorship.completedAt = now;
        mentorship.rewardGranted = true;
        profile.weekKey = weekKey;
        profile.weeklyCompleted = weeklyCompleted + 1;
        profile.reputation += 1;
        profile.updatedAt = now;
        state.metrics.mentoringCompleted += 1;
        return { reward: { mentorReputation: 1, cosmeticProgress: 1 } };
      },
    );
    return this.dashboard(session);
  }

}
