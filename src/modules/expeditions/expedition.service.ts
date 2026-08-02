import { createHash } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { GroupService } from '../groups/group.service.js';
import { ItemInventoryService } from '../items/item-inventory.service.js';
import {
  createItemInstanceSnapshot,
  parseItemDefinitionMetadata,
} from '../items/itemization.rules.js';
import { evaluateNarrativeConditions } from '../narrative/narrative.condition-resolver.js';
import { parseCharacterNarrativeState } from '../narrative/narrative.state.js';
import { SkillService } from '../skills/skill.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { ExpeditionCatalogService } from './expedition-catalog.service.js';
import {
  abandonExpedition,
  advanceExpedition,
  checkpointCurrentNode,
  chooseRitual,
  createExpeditionRun,
  failExpedition,
  markExtracted,
  resolveCurrentNode,
  startExpedition,
  terminalLoot,
} from './expedition.engine.js';
import {
  expeditionJson,
  ExpeditionPersistence,
  parseExpeditionRunSnapshot,
} from './expedition.persistence.js';
import {
  inspectExpeditionEncounterParty,
  type TrackedExpeditionParty,
} from './expedition.party.js';
import { deterministicUnit } from './expedition.random.js';
import type {
  ExpeditionContributionRecord,
  ExpeditionDifficulty,
  ExpeditionMemberSnapshot,
  ExpeditionPreparationSnapshot,
  ExpeditionRunSnapshot,
  ExpeditionRunStatus,
} from './expedition.types.js';
import {
  compileExpeditionView,
  type ExpeditionPublicView,
} from './expedition.view.js';

const operationIdPattern = /^[A-Za-z0-9:_-]{1,128}$/;
const terminalStatuses = new Set(['EXTRACTED', 'FAILED', 'ABANDONED', 'COMPLETED']);

type Formation = 'FRONT' | 'BACK';

export interface ExpeditionPrepareInput {
  operationId: string;
  definitionKey: string;
  definitionVersion?: number;
  difficulty: ExpeditionDifficulty;
  riskProfileKey: string;
  riskVersion: number;
  insurancePurchased: boolean;
  formationKey: string;
  roles: Record<string, { roleKey: string; formation: Formation }>;
}

export interface ExpeditionMutationInput {
  runId: string;
  operationId: string;
  expectedRevision: number;
}

export interface ExpeditionEncounterOutcomeInput {
  characterIds: string[];
  encounterKey: string;
  encounterVersion: number;
  combatId: string;
  result: 'VICTORY' | 'DEFEAT';
  contributions: Array<
    Omit<ExpeditionContributionRecord, 'combatId' | 'encounterKey' | 'encounterVersion'>
  >;
}

interface PreparationCharacterRecord {
  id: string;
  name: string;
  class: 'MAGE' | 'WARRIOR' | 'ARCHER';
  level: number;
  realmId: string;
  progressionData: Prisma.JsonValue;
  guildMembership: { role: 'LEADER' | 'OFFICER' | 'MEMBER' } | null;
  inventoryItems: Array<{
    id: string;
    equippedSlot: string | null;
    quantity: number;
    itemDefinition: { key: string };
  }>;
}

interface RewardItemDefinition {
  id: string;
  key: string;
  name: string;
  description: string;
  stackLimit: number;
  metadata: Prisma.JsonValue;
}

interface SettlementResult {
  characterId: string;
  silver: number;
  itemQuantity: number;
  claimQuantity: number;
}

@Injectable()
export class ExpeditionService implements OnModuleInit {
  private readonly trackedByCharacterId = new Map<string, TrackedExpeditionParty>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly catalog: ExpeditionCatalogService,
    private readonly persistence: ExpeditionPersistence,
    private readonly groups: GroupService,
    private readonly inventory: ItemInventoryService,
    private readonly skills: SkillService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  async onModuleInit(): Promise<void> {
    const records = await this.prisma.expeditionRun.findMany({
      where: { status: { in: ['PREPARING', 'ACTIVE'] } },
      select: { snapshot: true },
    }) as Array<{ snapshot: Prisma.JsonValue }>;
    for (const record of records) this.trackRun(parseExpeditionRunSnapshot(record.snapshot));
  }

  authorizeEncounterClaim(
    characterIds: readonly string[],
    partySize: number,
    encounterKey: string,
    encounterVersion: number,
  ): { variantKey?: string } | undefined {
    const authorization = inspectExpeditionEncounterParty(
      this.trackedByCharacterId,
      characterIds,
      partySize,
      encounterKey,
      encounterVersion,
    );
    if (authorization.mode === 'OPEN_WORLD') return undefined;
    if (!authorization.allowed) {
      throw new GameError(
        GAME_ERROR_CODES.COMBAT_FORBIDDEN,
        'errors.combat.forbidden',
        {
          reason: 'EXPEDITION_ENCOUNTER_NOT_ACTIVE',
          runId: authorization.runId,
        },
      );
    }
    return authorization.variantKey ? { variantKey: authorization.variantKey } : {};
  }

  listCatalog() {
    return this.catalog.list();
  }

  async getCurrent(session: PlayerSession): Promise<ExpeditionPublicView | null> {
    const membership =
      await this.persistence.findCurrentForCharacter(this.prisma, session.characterId) ??
      await this.persistence.findLatestForCharacter(this.prisma, session.characterId);
    if (!membership) return null;
    await this.prisma.expeditionMember.update({
      where: {
        runId_characterId: {
          runId: membership.runId,
          characterId: session.characterId,
        },
      },
      data: { lastSeenAt: new Date(), disconnectedAt: null },
    });
    return this.view(
      parseExpeditionRunSnapshot(membership.run.snapshot),
      session.characterId,
      session.realmId,
      session.mapId,
    );
  }

  async prepare(
    session: PlayerSession,
    input: ExpeditionPrepareInput,
  ): Promise<ExpeditionPublicView> {
    this.requireOperationId(input.operationId);
    const definition = this.catalog.require(
      input.definitionKey,
      input.definitionVersion,
    );
    const risk = definition.riskProfiles.find(
      (profile) =>
        profile.key === input.riskProfileKey &&
        profile.version === input.riskVersion,
    );
    if (!risk || !definition.difficultyProfiles.some((profile) => profile.key === input.difficulty)) {
      throw this.invalid('EXPEDITION_PREPARATION_INVALID');
    }

    const partySessions = this.requirePreparationParty(session);
    const characterIds = partySessions.map((member) => member.characterId);
    if (Object.keys(input.roles).some((characterId) => !characterIds.includes(characterId))) {
      throw this.invalid('EXPEDITION_ROLE_MEMBER_UNKNOWN');
    }
    const combatLoadouts = await Promise.all(
      partySessions.map(async (member) => ({
        characterId: member.characterId,
        loadout: await this.skills.getCombatLoadout(member.userId, member.characterId),
      })),
    );
    const combatLoadoutByCharacterId = new Map(
      combatLoadouts.map((entry) => [entry.characterId, entry.loadout]),
    );
    const records = await this.prisma.character.findMany({
      where: { id: { in: characterIds }, realmId: session.realmId },
      select: {
        id: true,
        name: true,
        class: true,
        level: true,
        realmId: true,
        progressionData: true,
        guildMembership: { select: { role: true } },
        inventoryItems: {
          select: {
            id: true,
            equippedSlot: true,
            quantity: true,
            itemDefinition: { select: { key: true } },
          },
          orderBy: { slotIndex: 'asc' },
        },
      },
    }) as PreparationCharacterRecord[];
    if (records.length !== characterIds.length) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    const recordById = new Map(records.map((record) => [record.id, record]));
    for (const member of partySessions) {
      const eligible = await this.persistence.evaluateConditions(this.prisma, {
        characterId: member.characterId,
        realmId: member.realmId,
        regionKey: member.mapId,
        partySize: partySessions.length,
        conditions: definition.entryConditions,
      });
      if (!eligible) throw this.invalid('EXPEDITION_ENTRY_CONDITIONS_FAILED');
    }

    const memberSnapshots: ExpeditionMemberSnapshot[] = partySessions.map((member) => {
      const record = recordById.get(member.characterId)!;
      const combatLoadout = combatLoadoutByCharacterId.get(member.characterId)!;
      const selectedRole = input.roles[member.characterId];
      const roleKey = selectedRole?.roleKey.trim() || this.defaultRole(record.class);
      const formation = selectedRole?.formation ?? this.defaultFormation(record.class);
      return {
        characterId: record.id,
        name: record.name,
        characterClass: record.class,
        level: record.level,
        roleKey,
        formation,
        loadout: {
          skillKeys: combatLoadout.definitions.map((entry) => entry.definition.key),
          fallbackAction: combatLoadout.fallbackAction,
          buildVersion: combatLoadout.buildVersion,
          ...(combatLoadout.loadoutId ? { loadoutId: combatLoadout.loadoutId } : {}),
          equippedItemIds: record.inventoryItems
            .filter((item) => item.equippedSlot)
            .map((item) => item.id),
          consumables: record.inventoryItems
            .filter((item) => !item.equippedSlot && item.itemDefinition.key.includes('potion'))
            .map((item) => ({ itemKey: item.itemDefinition.key, quantity: item.quantity })),
          ritualToolItemKeys: record.inventoryItems
            .filter((item) => item.itemDefinition.key.includes('ritual'))
            .map((item) => item.itemDefinition.key),
        },
      };
    });
    const preparation: ExpeditionPreparationSnapshot = {
      leaderCharacterId: session.characterId,
      members: memberSnapshots,
      selectedDifficulty: input.difficulty,
      selectedRiskProfileKey: risk.key,
      acceptedRiskVersion: risk.version,
      insurancePurchased: input.insurancePurchased,
      formationKey: input.formationKey.trim() || 'balanced',
      ritualChoices: {},
      declarativeRoles: Object.fromEntries(
        memberSnapshots.map((member) => [member.characterId, member.roleKey]),
      ),
      lockedFields: [
        'members',
        'loadout',
        'roles',
        'formation',
        'difficulty',
        'risk',
        'insurance',
      ],
    };
    const runId = this.operationUuid(session.characterId, input.operationId);
    const seed = this.operationSeed(runId, definition.contentVersion);
    const createdSnapshot = createExpeditionRun({
      runId,
      definition,
      seed,
      preparation,
      epochDay: Math.floor(Date.now() / 86_400_000),
    });

    let committed: ExpeditionRunSnapshot;
    try {
      committed = await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.expeditionRun.findUnique({
          where: { id: runId },
          select: { leaderCharacterId: true, snapshot: true },
        });
        if (existing) {
          const existingSnapshot = parseExpeditionRunSnapshot(existing.snapshot);
          if (
            existing.leaderCharacterId !== session.characterId ||
            !this.matchesPreparationRetry(existingSnapshot, createdSnapshot)
          ) {
            throw this.invalid('EXPEDITION_OPERATION_COLLISION');
          }
          return existingSnapshot;
        }
        await transaction.expeditionRun.create({
          data: {
            id: runId,
            realmId: session.realmId,
            leaderCharacterId: session.characterId,
            definitionKey: definition.key,
            definitionVersion: definition.version,
            contentVersion: definition.contentVersion,
            seed,
            status: createdSnapshot.status,
            currentNodeKey: createdSnapshot.currentNodeKey,
            revision: createdSnapshot.revision,
            snapshot: expeditionJson(createdSnapshot),
            members: {
              create: memberSnapshots.map((member) => ({
                characterId: member.characterId,
                roleKey: member.roleKey,
                formation: member.formation,
                loadoutSnapshot: expeditionJson(member.loadout),
                riskAccepted: true,
                rewardEligible: true,
              })),
            },
          },
        });
        await transaction.expeditionActiveMember.createMany({
          data: memberSnapshots.map((member) => ({
            characterId: member.characterId,
            runId,
          })),
        });
        return createdSnapshot;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      throw this.publicError(error, 'EXPEDITION_PREPARE_FAILED');
    }
    await this.publish(committed);
    return this.view(committed, session.characterId, session.realmId, session.mapId);
  }

  async start(
    session: PlayerSession,
    input: ExpeditionMutationInput,
  ): Promise<ExpeditionPublicView> {
    this.requireOperationId(input.operationId);
    try {
      const committed = await this.prisma.$transaction(async (transaction) => {
        const record = await this.persistence.lockRun(transaction, input.runId);
        const snapshot = parseExpeditionRunSnapshot(record.snapshot);
        this.requireLeader(snapshot, session.characterId);
        const replay = await this.persistence.claimOperation(
          transaction,
          input.runId,
          input.operationId,
          'START',
        );
        if (replay) return { run: snapshot, leaderSilver: undefined as number | undefined };
        if (snapshot.revision !== input.expectedRevision) {
          throw this.invalid('EXPEDITION_REVISION_CONFLICT');
        }
        await this.persistence.lockCharacter(transaction, session.characterId);
        const leader = await transaction.character.findUnique({
          where: { id: session.characterId },
          select: { silver: true },
        });
        if (!leader) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
        const cost = snapshot.definitionSnapshot.preparationCost.silver +
          (snapshot.preparation.insurancePurchased
            ? snapshot.riskSnapshot.insuranceCostSilver
            : 0);
        if (leader.silver < cost) {
          throw new GameError(
            GAME_ERROR_CODES.INSUFFICIENT_SILVER,
            'errors.items.insufficientSilver',
          );
        }
        if (snapshot.definitionSnapshot.preparationCost.items.length > 0) {
          await this.inventory.consumeByDefinitionKeys(
            transaction,
            session.characterId,
            snapshot.definitionSnapshot.preparationCost.items,
          );
        }
        const updated = cost > 0
          ? await transaction.character.update({
              where: { id: session.characterId },
              data: { silver: { decrement: cost }, stateVersion: { increment: 1 } },
              select: { silver: true },
            })
          : leader;
        if (cost > 0) {
          await transaction.characterCurrencyLedger.create({
            data: {
              characterId: session.characterId,
              operationId: this.ledgerOperation(input.runId, input.operationId, 'prepare'),
              currency: 'SILVER',
              direction: 'DEBIT',
              amount: cost,
              reason: 'EXPEDITION_PREPARATION',
              balanceAfter: updated.silver,
              metadata: expeditionJson({
                runId: input.runId,
                riskProfile: snapshot.riskSnapshot.key,
                insurance: snapshot.preparation.insurancePurchased,
              }),
            },
          });
        }
        const startedAt = new Date();
        const run = startExpedition(snapshot, startedAt.toISOString());
        await this.persistence.persistRun(transaction, run);
        await transaction.expeditionRun.update({
          where: { id: run.runId },
          data: { startedAt },
        });
        await this.persistence.completeOperation(
          transaction,
          input.runId,
          input.operationId,
          run.processedOperations[input.operationId] ?? {
            operationId: input.operationId,
            kind: 'START',
            revision: run.revision,
            status: run.status,
            nodeKey: run.currentNodeKey,
          },
        );
        return { run, leaderSilver: updated.silver };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      if (committed.leaderSilver !== undefined) {
        session.silver = committed.leaderSilver;
        session.stateRevision += 1;
        session.dirty = true;
      }
      await this.publish(committed.run);
      return this.view(committed.run, session.characterId, session.realmId, session.mapId);
    } catch (error) {
      throw this.publicError(error, 'EXPEDITION_START_FAILED');
    }
  }

  async advance(
    session: PlayerSession,
    input: ExpeditionMutationInput & { edgeKey: string },
  ): Promise<ExpeditionPublicView> {
    this.requireOperationId(input.operationId);
    try {
      const committed = await this.prisma.$transaction(async (transaction) => {
        const record = await this.persistence.lockRun(transaction, input.runId);
        let run = parseExpeditionRunSnapshot(record.snapshot);
        this.requireLeader(run, session.characterId);
        const replay = await this.persistence.claimOperation(
          transaction,
          input.runId,
          input.operationId,
          'ADVANCE',
        );
        if (replay) return { run, settlement: [] as SettlementResult[] };
        const context = await this.persistence.buildConditionContext(transaction, {
          characterId: session.characterId,
          realmId: session.realmId,
          regionKey: session.mapId,
          partySize: run.preparation.members.length,
        });
        const advanced = advanceExpedition(run, {
          operationId: input.operationId,
          edgeKey: input.edgeKey,
          expectedRevision: input.expectedRevision,
          conditionEvaluator: (conditions) =>
            evaluateNarrativeConditions(conditions, context),
        });
        run = advanced.run;
        run = this.autoResolveArrivedNode(run, input.operationId);
        if (run.status === 'FAILED') {
          ({ run } = failExpedition(run, {
            operationId: `${input.operationId}:failure`,
            expectedRevision: run.revision,
            sourceNodeKey: run.currentNodeKey,
          }));
        }
        const settlement = terminalStatuses.has(run.status)
          ? await this.settleTerminal(transaction, run, input.operationId)
          : [];
        await this.persistence.persistRun(transaction, run);
        await this.persistence.completeOperation(
          transaction,
          input.runId,
          input.operationId,
          {
            ...advanced.result,
            revision: run.revision,
            status: run.status,
            nodeKey: run.currentNodeKey,
          },
        );
        if (terminalStatuses.has(run.status)) {
          await this.persistence.releaseActiveMembers(transaction, run.runId);
        }
        return { run, settlement };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await this.syncSettlement(committed.settlement);
      await this.publish(committed.run);
      return this.view(committed.run, session.characterId, session.realmId, session.mapId);
    } catch (error) {
      throw this.publicError(error, 'EXPEDITION_ADVANCE_FAILED');
    }
  }

  async selectRitual(
    session: PlayerSession,
    input: ExpeditionMutationInput & { choiceKey: string },
  ): Promise<ExpeditionPublicView> {
    this.requireOperationId(input.operationId);
    try {
      const run = await this.prisma.$transaction(async (transaction) => {
        const record = await this.persistence.lockRun(transaction, input.runId);
        const snapshot = parseExpeditionRunSnapshot(record.snapshot);
        this.requireLeader(snapshot, session.characterId);
        const replay = await this.persistence.claimOperation(
          transaction,
          input.runId,
          input.operationId,
          'RITUAL_CHOICE',
        );
        if (replay) return snapshot;
        const changed = chooseRitual(snapshot, {
          operationId: input.operationId,
          choiceKey: input.choiceKey,
          expectedRevision: input.expectedRevision,
        });
        await this.persistence.persistRun(transaction, changed.run);
        await this.persistence.completeOperation(
          transaction,
          input.runId,
          input.operationId,
          changed.result,
        );
        return changed.run;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await this.publish(run);
      return this.view(run, session.characterId, session.realmId, session.mapId);
    } catch (error) {
      throw this.publicError(error, 'EXPEDITION_RITUAL_FAILED');
    }
  }

  async extract(
    session: PlayerSession,
    input: ExpeditionMutationInput,
  ): Promise<ExpeditionPublicView> {
    return this.finishByLeader(session, input, 'EXTRACT');
  }

  async abandon(
    session: PlayerSession,
    input: ExpeditionMutationInput,
  ): Promise<ExpeditionPublicView> {
    return this.finishByLeader(session, input, 'ABANDON');
  }

  async recordEncounterOutcome(
    input: ExpeditionEncounterOutcomeInput,
  ): Promise<boolean> {
    if (input.characterIds.length === 0) return false;
    const active = await this.prisma.expeditionActiveMember.findMany({
      where: { characterId: { in: input.characterIds } },
      select: { runId: true },
      distinct: ['runId'],
    }) as Array<{ runId: string }>;
    if (active.length === 0) return false;
    const candidateRuns = await this.prisma.expeditionRun.findMany({
      where: { id: { in: active.map((entry) => entry.runId) }, status: 'ACTIVE' },
      select: { id: true, snapshot: true },
    }) as Array<{ id: string; snapshot: Prisma.JsonValue }>;
    const matching = candidateRuns.find((record) => {
      const snapshot = parseExpeditionRunSnapshot(record.snapshot);
      return snapshot.pendingEncounter?.encounterKey === input.encounterKey &&
        snapshot.pendingEncounter.encounterVersion === input.encounterVersion;
    });
    if (!matching) return true;
    const matchingSnapshot = parseExpeditionRunSnapshot(matching.snapshot);
    const expectedMembers = new Set(
      matchingSnapshot.preparation.members.map((member) => member.characterId),
    );
    const combatMembers = new Set(input.characterIds);
    if (
      expectedMembers.size !== combatMembers.size ||
      [...expectedMembers].some((characterId) => !combatMembers.has(characterId))
    ) {
      throw this.invalid('EXPEDITION_PARTY_MISMATCH');
    }
    const operationId = `combat:${input.combatId}`.slice(0, 128);
    const committed = await this.prisma.$transaction(async (transaction) => {
      const record = await this.persistence.lockRun(transaction, matching.id);
      let run = parseExpeditionRunSnapshot(record.snapshot);
      const replay = await this.persistence.claimOperation(
        transaction,
        run.runId,
        operationId,
        'ENCOUNTER_OUTCOME',
      );
      if (replay) return { run, settlement: [] as SettlementResult[] };
      if (
        run.pendingEncounter?.encounterKey !== input.encounterKey ||
        run.pendingEncounter.encounterVersion !== input.encounterVersion
      ) {
        throw this.invalid('EXPEDITION_ENCOUNTER_MISMATCH');
      }
      const contributionCharacters = new Set(
        input.contributions.map((contribution) => contribution.characterId),
      );
      if (
        input.contributions.length !== expectedMembers.size ||
        contributionCharacters.size !== expectedMembers.size ||
        [...expectedMembers].some((characterId) => !contributionCharacters.has(characterId))
      ) {
        throw this.invalid('EXPEDITION_CONTRIBUTION_PARTY_MISMATCH');
      }
      run.contributions.push(...input.contributions.map((contribution) => ({
        ...contribution,
        combatId: input.combatId,
        encounterKey: input.encounterKey,
        encounterVersion: input.encounterVersion,
      })));
      const resolved = resolveCurrentNode(run, {
        operationId,
        expectedRevision: run.revision,
        outcome: input.result === 'VICTORY' ? 'VICTORY' : 'FAILURE',
      });
      run = resolved.run;
      if (input.result === 'DEFEAT') {
        ({ run } = failExpedition(run, {
          operationId: `${operationId}:failure`,
          expectedRevision: run.revision,
          sourceNodeKey: run.currentNodeKey,
        }));
      }
      const settlement = terminalStatuses.has(run.status)
        ? await this.settleTerminal(transaction, run, operationId)
        : [];
      await this.persistence.persistRun(transaction, run);
      await this.persistence.completeOperation(
        transaction,
        run.runId,
        operationId,
        {
          ...resolved.result,
          revision: run.revision,
          status: run.status,
          nodeKey: run.currentNodeKey,
        },
      );
      if (terminalStatuses.has(run.status)) {
        await this.persistence.releaseActiveMembers(transaction, run.runId);
      }
      return { run, settlement };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await this.syncSettlement(committed.settlement);
    await this.publish(committed.run);
    return true;
  }

  private async finishByLeader(
    session: PlayerSession,
    input: ExpeditionMutationInput,
    mode: 'EXTRACT' | 'ABANDON',
  ): Promise<ExpeditionPublicView> {
    this.requireOperationId(input.operationId);
    try {
      const committed = await this.prisma.$transaction(async (transaction) => {
        const record = await this.persistence.lockRun(transaction, input.runId);
        const snapshot = parseExpeditionRunSnapshot(record.snapshot);
        this.requireLeader(snapshot, session.characterId);
        const replay = await this.persistence.claimOperation(
          transaction,
          input.runId,
          input.operationId,
          mode,
        );
        if (replay) return { run: snapshot, settlement: [] as SettlementResult[] };
        const changed = mode === 'EXTRACT'
          ? markExtracted(snapshot, {
              operationId: input.operationId,
              expectedRevision: input.expectedRevision,
              now: new Date().toISOString(),
            })
          : abandonExpedition(snapshot, {
              operationId: input.operationId,
              expectedRevision: input.expectedRevision,
              now: new Date().toISOString(),
            });
        const settlement = await this.settleTerminal(
          transaction,
          changed.run,
          input.operationId,
        );
        await this.persistence.persistRun(transaction, changed.run);
        await this.persistence.completeOperation(
          transaction,
          input.runId,
          input.operationId,
          changed.result,
        );
        await this.persistence.releaseActiveMembers(transaction, changed.run.runId);
        return { run: changed.run, settlement };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      await this.syncSettlement(committed.settlement);
      await this.publish(committed.run);
      return this.view(committed.run, session.characterId, session.realmId, session.mapId);
    } catch (error) {
      throw this.publicError(error, `EXPEDITION_${mode}_FAILED`);
    }
  }

  private autoResolveArrivedNode(
    source: ExpeditionRunSnapshot,
    operationId: string,
  ): ExpeditionRunSnapshot {
    if (source.status !== 'ACTIVE') return source;
    const node = source.definitionSnapshot.nodes.find(
      (candidate) => candidate.key === source.currentNodeKey,
    );
    if (!node) throw new Error('EXPEDITION_NODE_UNKNOWN');
    if (node.checkpoint) {
      return checkpointCurrentNode(source, {
        operationId: `${operationId}:checkpoint`,
        expectedRevision: source.revision,
      }).run;
    }
    if (['INVESTIGATION', 'EVENT', 'REST', 'MERCHANT'].includes(node.type)) {
      return resolveCurrentNode(source, {
        operationId: `${operationId}:automatic`,
        expectedRevision: source.revision,
        outcome: 'SUCCESS',
      }).run;
    }
    if (node.type === 'HAZARD') {
      const threat = source.resources.threat ?? 0;
      const failed = deterministicUnit(
        source.seed,
        'hazard',
        node.key,
        source.decisions.length,
      ) < Math.min(0.65, 0.18 + threat * 0.04);
      return resolveCurrentNode(source, {
        operationId: `${operationId}:hazard`,
        expectedRevision: source.revision,
        outcome: failed ? 'FAILURE' : 'SUCCESS',
      }).run;
    }
    return source;
  }

  private async settleTerminal(
    transaction: Prisma.TransactionClient,
    run: ExpeditionRunSnapshot,
    terminalOperationId: string,
  ): Promise<SettlementResult[]> {
    const loot = terminalLoot(run);
    const itemKeys = [...new Set(loot.flatMap((stack) => stack.itemKey ? [stack.itemKey] : []))];
    const definitions = (itemKeys.length > 0
      ? await transaction.itemDefinition.findMany({ where: { key: { in: itemKeys } } })
      : []) as RewardItemDefinition[];
    const definitionByKey = new Map(definitions.map((definition) => [definition.key, definition]));
    if (definitionByKey.size !== itemKeys.length) {
      throw this.invalid('EXPEDITION_LOOT_DEFINITION_MISSING');
    }
    const settlements: SettlementResult[] = [];
    for (const member of run.preparation.members) {
      const existing = await transaction.expeditionRewardLedger.findUnique({
        where: {
          runId_characterId: {
            runId: run.runId,
            characterId: member.characterId,
          },
        },
      });
      if (existing) {
        const result = existing.settlement as unknown as SettlementResult;
        settlements.push(result);
        continue;
      }
      await this.persistence.lockCharacter(transaction, member.characterId);
      const character = await transaction.character.findUnique({
        where: { id: member.characterId },
        select: { silver: true, progressionData: true },
      });
      if (!character) {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }
      const silver = loot.reduce((sum, stack) => sum + (stack.silver ?? 0), 0);
      let itemQuantity = 0;
      let claimQuantity = 0;
      for (const stack of loot) {
        if (!stack.itemKey) continue;
        const definition = definitionByKey.get(stack.itemKey)!;
        const metadata = parseItemDefinitionMetadata(definition.metadata);
        const quantity = stack.quantity ?? 1;
        const granted = await this.inventory.grant(transaction, {
          characterId: member.characterId,
          definition,
          quantity,
          snapshot: createItemInstanceSnapshot({
            definitionKey: definition.key,
            metadata,
            seed: `${run.seed}:${member.characterId}:${stack.sourceKey}`,
            origin: {
              source: 'LOOT',
              sourceKey: `${run.definitionKey}:${stack.sourceKey}`,
              operationId: this.ledgerOperation(
                run.runId,
                terminalOperationId,
                `${member.characterId}:${stack.sourceKey}`,
              ),
              contentVersion: run.definitionVersion,
              generatedAt: new Date().toISOString(),
              encounterKey: run.pendingEncounter?.encounterKey,
            },
          }),
          operationId: this.ledgerOperation(
            run.runId,
            terminalOperationId,
            `${member.characterId}:${stack.sourceKey}:item`,
          ),
          reason: `EXPEDITION:${run.definitionKey}:${run.status}`,
          claimOverflow: true,
        });
        itemQuantity += granted.grantedQuantity;
        claimQuantity += granted.claimedQuantity;
      }
      const progression = this.progressionRecord(character.progressionData);
      const narrative = parseCharacterNarrativeState(progression.narrative);
      for (const consequence of run.consequences) {
        if (consequence.key === 'ritual-corruption') {
          narrative.consequences.corruption = Math.min(
            100,
            narrative.consequences.corruption + consequence.severity,
          );
        } else {
          narrative.consequences.wounds[consequence.key] =
            (narrative.consequences.wounds[consequence.key] ?? 0) +
            consequence.severity;
        }
      }
      progression.narrative = narrative;
      const updated = await transaction.character.update({
        where: { id: member.characterId },
        data: {
          ...(silver > 0 ? { silver: { increment: silver } } : {}),
          progressionData: expeditionJson(progression),
          stateVersion: { increment: 1 },
        },
        select: { silver: true },
      });
      if (silver > 0) {
        await transaction.characterCurrencyLedger.create({
          data: {
            characterId: member.characterId,
            operationId: this.ledgerOperation(
              run.runId,
              terminalOperationId,
              `${member.characterId}:silver`,
            ),
            currency: 'SILVER',
            direction: 'CREDIT',
            amount: silver,
            reason: 'EXPEDITION_SETTLEMENT',
            balanceAfter: updated.silver,
            metadata: expeditionJson({
              runId: run.runId,
              definitionKey: run.definitionKey,
              definitionVersion: run.definitionVersion,
              status: run.status,
            }),
          },
        });
      }
      const settlement: SettlementResult = {
        characterId: member.characterId,
        silver,
        itemQuantity,
        claimQuantity,
      };
      await transaction.expeditionRewardLedger.create({
        data: {
          runId: run.runId,
          characterId: member.characterId,
          operationId: this.ledgerOperation(
            run.runId,
            terminalOperationId,
            `${member.characterId}:reward`,
          ),
          definitionVersion: run.definitionVersion,
          settlement: expeditionJson(settlement),
        },
      });
      settlements.push(settlement);
    }
    return settlements;
  }

  private requirePreparationParty(session: PlayerSession): PlayerSession[] {
    const group = this.groups.getSnapshot(session).group;
    if (!group) {
      if (session.combatState !== 'IDLE') {
        throw new GameError(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
      }
      return [session];
    }
    if (group.adminCharacterId !== session.characterId) {
      throw new GameError(GAME_ERROR_CODES.GROUP_FORBIDDEN, 'errors.group.forbidden');
    }
    const members = group.members.map((member: { characterId: string }) =>
      this.world.getByCharacterId(member.characterId),
    );
    if (members.some((member: PlayerSession | undefined) =>
      !member?.activeInWorld ||
      member.realmId !== session.realmId ||
      member.mapId !== session.mapId ||
      member.combatState !== 'IDLE'
    )) {
      throw new GameError(
        GAME_ERROR_CODES.GROUP_PARTICIPANT_UNAVAILABLE,
        'errors.group.participantUnavailable',
      );
    }
    return members as PlayerSession[];
  }

  private requireLeader(run: ExpeditionRunSnapshot, characterId: string): void {
    if (run.preparation.leaderCharacterId !== characterId) {
      throw new GameError(GAME_ERROR_CODES.GROUP_FORBIDDEN, 'errors.group.forbidden');
    }
  }

  private async view(
    run: ExpeditionRunSnapshot,
    characterId: string,
    realmId: string,
    regionKey: string,
  ): Promise<ExpeditionPublicView> {
    const context = await this.persistence.buildConditionContext(this.prisma, {
      characterId,
      realmId,
      regionKey,
      partySize: run.preparation.members.length,
    });
    return compileExpeditionView(
      run,
      (conditions) => evaluateNarrativeConditions(conditions, context),
    );
  }

  private async publish(run: ExpeditionRunSnapshot): Promise<void> {
    this.trackRun(run);
    await Promise.all(run.preparation.members.map(async (member) => {
      const session = this.world.getByCharacterId(member.characterId);
      if (!session?.activeInWorld) return;
      const view = await this.view(run, member.characterId, session.realmId, session.mapId);
      this.publisher.emit(session.socketId, 'expedition:updated', view);
    }));
  }

  private trackRun(run: ExpeditionRunSnapshot): void {
    const terminal = terminalStatuses.has(run.status);
    for (const member of run.preparation.members) {
      const current = this.trackedByCharacterId.get(member.characterId);
      if (terminal) {
        if (current?.runId === run.runId) this.trackedByCharacterId.delete(member.characterId);
      } else {
        this.trackedByCharacterId.set(member.characterId, {
          runId: run.runId,
          status: run.status,
          memberCharacterIds: run.preparation.members.map((entry) => entry.characterId),
          ...(run.pendingEncounter
            ? { pendingEncounter: structuredClone(run.pendingEncounter) }
            : {}),
        });
      }
    }
  }

  private async syncSettlement(settlements: readonly SettlementResult[]): Promise<void> {
    for (const settlement of settlements) {
      const session = this.world.getByCharacterId(settlement.characterId);
      if (!session?.activeInWorld) continue;
      const character = await this.prisma.character.findUnique({
        where: { id: settlement.characterId },
        select: { silver: true, stateVersion: true },
      });
      if (!character) continue;
      session.silver = character.silver;
      session.stateRevision = Math.max(session.stateRevision + 1, character.stateVersion);
      session.dirty = false;
      session.persistedRevision = Math.max(session.persistedRevision, character.stateVersion);
    }
  }

  private defaultRole(characterClass: ExpeditionMemberSnapshot['characterClass']): string {
    switch (characterClass) {
      case 'WARRIOR': return 'guardian';
      case 'MAGE': return 'ritualist';
      case 'ARCHER': return 'scout';
    }
  }

  private defaultFormation(characterClass: ExpeditionMemberSnapshot['characterClass']): Formation {
    return characterClass === 'WARRIOR' ? 'FRONT' : 'BACK';
  }

  private operationUuid(characterId: string, operationId: string): string {
    const hex = createHash('sha256')
      .update(`expedition:${characterId}:${operationId}`)
      .digest('hex')
      .slice(0, 32)
      .split('');
    hex[12] = '4';
    hex[16] = ['8', '9', 'a', 'b'][parseInt(hex[16] ?? '0', 16) % 4]!;
    const value = hex.join('');
    return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
  }

  private operationSeed(runId: string, contentVersion: string): number {
    return createHash('sha256')
      .update(`${runId}:${contentVersion}`)
      .digest()
      .readUInt32BE(0) % 2_147_483_647;
  }

  private matchesPreparationRetry(
    existing: ExpeditionRunSnapshot,
    requested: ExpeditionRunSnapshot,
  ): boolean {
    const existingMembers = existing.preparation.members.map((member) => ({
      characterId: member.characterId,
      roleKey: member.roleKey,
      formation: member.formation,
    }));
    const requestedMembers = requested.preparation.members.map((member) => ({
      characterId: member.characterId,
      roleKey: member.roleKey,
      formation: member.formation,
    }));
    return (
      existing.definitionKey === requested.definitionKey &&
      existing.definitionVersion === requested.definitionVersion &&
      existing.preparation.selectedDifficulty === requested.preparation.selectedDifficulty &&
      existing.preparation.selectedRiskProfileKey === requested.preparation.selectedRiskProfileKey &&
      existing.preparation.acceptedRiskVersion === requested.preparation.acceptedRiskVersion &&
      existing.preparation.insurancePurchased === requested.preparation.insurancePurchased &&
      existing.preparation.formationKey === requested.preparation.formationKey &&
      JSON.stringify(existingMembers) === JSON.stringify(requestedMembers)
    );
  }

  private ledgerOperation(runId: string, operationId: string, suffix: string): string {
    const digest = createHash('sha256')
      .update(`${runId}:${operationId}:${suffix}`)
      .digest('hex')
      .slice(0, 48);
    return `expedition:${digest}`;
  }

  private progressionRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? structuredClone(value) as Record<string, unknown>
      : {};
  }

  private requireOperationId(operationId: string): void {
    if (!operationIdPattern.test(operationId)) {
      throw this.invalid('EXPEDITION_OPERATION_ID_INVALID');
    }
  }

  private invalid(reason: string): GameError {
    return new GameError(
      GAME_ERROR_CODES.INVALID_PAYLOAD,
      'errors.payload.invalid',
      { reason },
    );
  }

  private publicError(error: unknown, fallbackReason: string): GameError {
    if (error instanceof GameError) return error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    ) {
      return this.invalid('EXPEDITION_MEMBER_ALREADY_ACTIVE');
    }
    return this.invalid(
      error instanceof Error ? error.message : fallbackReason,
    );
  }
}
