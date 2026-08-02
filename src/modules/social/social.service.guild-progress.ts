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

export abstract class SocialGuildProgressService extends SocialCommunityService {
  async createContract(
    session: PlayerSession,
    input: SocialGuildCreateObjectivePayload,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.permissions.require(actor, 'CONTRACT_MANAGE');
    const definition = CONTRACT_CATALOG[input.definitionKey as keyof typeof CONTRACT_CATALOG];
    if (!definition || definition.version !== input.definitionVersion) {
      throw this.socialError('SOCIAL_DEFINITION_INVALID');
    }
    await this.mutateGuild(actor, input.operationId, 'CONTRACT_CREATE', input, 'CONTRACT_MANAGE', (state, now) => {
      const activeCount = Object.values(state.contracts).filter((contract) => contract.status === 'ACTIVE').length;
      if (activeCount >= 3) throw this.socialError('SOCIAL_OBJECTIVE_LIMIT');
      const id = randomUUID();
      state.contracts[id] = {
        id,
        definitionKey: input.definitionKey,
        definitionVersion: definition.version,
        snapshot: {
          title: definition.title,
          target: definition.target,
          rewardXp: definition.rewardXp,
          rewardUnlockKey: definition.rewardUnlockKey,
          contributionKinds: [...definition.contributionKinds],
          perCharacterCap: definition.perCharacterCap,
          perAccountCap: definition.perAccountCap,
        },
        status: 'ACTIVE',
        startsAt: now,
        endsAt: new Date(new Date(now).getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
        contributions: [],
      };
      return { instanceId: id };
    });
    return this.dashboard(session);
  }

  async contributeContract(
    session: PlayerSession,
    input: SocialGuildContributionPayload,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.mutateGuild(actor, input.operationId, 'CONTRACT_CONTRIBUTE', input, undefined, (state, now) => {
      const contract = state.contracts[input.instanceId];
      if (!contract || contract.status !== 'ACTIVE') throw this.socialError('SOCIAL_OBJECTIVE_NOT_ACTIVE');
      contract.contributions.push({
        operationId: input.operationId,
        characterId: session.characterId,
        userId: session.userId,
        kind: input.kind,
        amount: input.amount,
        qualified: input.qualified,
        afk: input.afk,
        sourceKey: input.sourceKey,
        createdAt: now,
      });
      const progress = contractProgress(contract);
      state.contributionByCharacter[session.characterId] =
        (state.contributionByCharacter[session.characterId] ?? 0) +
        (input.qualified && !input.afk ? input.amount : 0);
      if (progress >= contract.snapshot.target) contract.status = 'COMPLETED';
      return { progress, target: contract.snapshot.target };
    });
    return this.dashboard(session);
  }

  async settleContract(
    session: PlayerSession,
    operationId: string,
    instanceId: string,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.permissions.require(actor, 'CONTRACT_MANAGE');
    await this.mutateGuild(actor, operationId, 'CONTRACT_SETTLE', { instanceId }, 'CONTRACT_MANAGE', async (state, now, tx) => {
      const contract = state.contracts[instanceId];
      if (!contract || contract.status !== 'COMPLETED') throw this.socialError('SOCIAL_OBJECTIVE_INCOMPLETE');
      contract.status = 'SETTLED';
      contract.settlementOperationId = operationId;
      contract.settledAt = now;
      if (contract.snapshot.rewardUnlockKey) {
        state.unlockKeys = [...new Set([...state.unlockKeys, contract.snapshot.rewardUnlockKey])];
      }
      state.xpAudit.push({
        operationId,
        sourceType: 'CONTRACT',
        sourceId: instanceId,
        amount: contract.snapshot.rewardXp,
        createdAt: now,
      });
      await this.grantGuildXp(tx, actor.guildId, contract.snapshot.rewardXp);
      return { xp: contract.snapshot.rewardXp };
    });
    await this.addGuildRewardMetric(session, actor.guildId, operationId, 1);
    return this.dashboard(session);
  }

  async createProject(
    session: PlayerSession,
    input: SocialGuildCreateObjectivePayload,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.permissions.require(actor, 'PROJECT_MANAGE');
    const definition = PROJECT_CATALOG[input.definitionKey as keyof typeof PROJECT_CATALOG];
    if (!definition || definition.version !== input.definitionVersion) {
      throw this.socialError('SOCIAL_DEFINITION_INVALID');
    }
    await this.mutateGuild(actor, input.operationId, 'PROJECT_CREATE', input, 'PROJECT_MANAGE', (state) => {
      if (Object.values(state.projects).some((project) => project.status === 'ACTIVE')) {
        throw this.socialError('SOCIAL_OBJECTIVE_LIMIT');
      }
      const id = randomUUID();
      state.projects[id] = {
        id,
        definitionKey: input.definitionKey,
        definitionVersion: definition.version,
        snapshot: {
          title: definition.title,
          stages: definition.stages.map((stage) => ({
            key: stage.key,
            target: stage.target,
            contributionKinds: [...stage.contributionKinds],
          })),
          unlockKey: definition.unlockKey,
          rewardXp: definition.rewardXp,
        },
        stageIndex: 0,
        stageProgress: 0,
        status: 'ACTIVE',
        contributions: [],
      };
      return { instanceId: id };
    });
    return this.dashboard(session);
  }

  async contributeProject(
    session: PlayerSession,
    input: SocialGuildContributionPayload,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.mutateGuild(actor, input.operationId, 'PROJECT_CONTRIBUTE', input, undefined, (state, now) => {
      const project = state.projects[input.instanceId];
      if (!project || project.status !== 'ACTIVE') throw this.socialError('SOCIAL_OBJECTIVE_NOT_ACTIVE');
      project.contributions.push({
        operationId: input.operationId,
        characterId: session.characterId,
        userId: session.userId,
        kind: input.kind,
        amount: input.amount,
        qualified: input.qualified,
        afk: input.afk,
        sourceKey: input.sourceKey,
        createdAt: now,
      });
      project.stageProgress = projectStageProgress(project);
      const stage = project.snapshot.stages[project.stageIndex];
      if (stage && project.stageProgress >= stage.target) {
        project.stageIndex += 1;
        project.stageProgress = 0;
        project.contributions = [];
        if (project.stageIndex >= project.snapshot.stages.length) project.status = 'COMPLETED';
      }
      return {
        stageIndex: project.stageIndex,
        stageProgress: project.stageProgress,
        completed: project.status === 'COMPLETED',
      };
    });
    return this.dashboard(session);
  }

  async settleProject(
    session: PlayerSession,
    operationId: string,
    instanceId: string,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.permissions.require(actor, 'PROJECT_MANAGE');
    await this.mutateGuild(actor, operationId, 'PROJECT_SETTLE', { instanceId }, 'PROJECT_MANAGE', async (state, now, tx) => {
      const project = state.projects[instanceId];
      if (!project || project.status !== 'COMPLETED') throw this.socialError('SOCIAL_OBJECTIVE_INCOMPLETE');
      project.status = 'SETTLED';
      project.settlementOperationId = operationId;
      project.settledAt = now;
      state.unlockKeys = [...new Set([...state.unlockKeys, project.snapshot.unlockKey])];
      state.xpAudit.push({
        operationId,
        sourceType: 'PROJECT',
        sourceId: instanceId,
        amount: project.snapshot.rewardXp,
        createdAt: now,
      });
      await this.grantGuildXp(tx, actor.guildId, project.snapshot.rewardXp);
      return { xp: project.snapshot.rewardXp, unlockKey: project.snapshot.unlockKey };
    });
    await this.addGuildRewardMetric(session, actor.guildId, operationId, 1);
    return this.dashboard(session);
  }

  async contributeRegion(
    session: PlayerSession,
    input: SocialRegionContributionPayload,
  ): Promise<SocialDashboardView> {
    const membership = await this.prisma.guildMember.findUnique({ where: { characterId: session.characterId } });
    await this.mutateRealm(session, input.operationId, 'REGION_CONTRIBUTE', input, (state, now) => {
      const key = `${input.regionKey}:${input.phaseKey}`;
      const current: RegionGoalState = state.regionGoals[key] ?? {
        regionKey: input.regionKey,
        phaseKey: input.phaseKey,
        target: 10_000,
        totalEffectiveContribution: 0,
        contributionByCharacter: {},
        contributionByGuild: {},
        updatedAt: now,
      };
      const applied = applyRegionContribution(
        current,
        session.characterId,
        membership?.guildId,
        input.amount,
        now,
      );
      state.regionGoals[key] = applied.goal;
      return { effectiveAmount: applied.effectiveAmount };
    });
    return this.dashboard(session);
  }

  async setGuildPermission(
    session: PlayerSession,
    operationId: string,
    role: GuildRole,
    permission: GuildSocialPermission,
    allowed: boolean,
  ): Promise<SocialDashboardView> {
    const actor = await this.permissions.actor(session.userId, session.characterId);
    await this.mutateGuild(
      actor,
      operationId,
      'PERMISSION_SET',
      { role, permission, allowed },
      'ROLE',
      async (_state, _now, tx) => {
        const currentActor = await this.currentGuildActor(tx, actor);
        await this.permissions.setOverride(currentActor, role, permission, allowed, tx);
        return { role, permission, allowed };
      },
    );
    return this.dashboard(session);
  }

}
