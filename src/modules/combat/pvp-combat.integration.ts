import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { CombatSnapshot } from '../../contracts/socket.events.js';
import { GroupService } from '../groups/group.service.js';
import { MapService } from '../maps/map.service.js';
import { TradeService } from '../player/trade/trade.service.js';
import {
  PvpPolicyViolationError,
  PvpService,
  type EvaluatePvpCombatInput,
} from '../pvp/pvp.service.js';
import type { PvpEngagementDecision, PvpEngagementKind, PvpModeKey } from '../pvp/pvp.types.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { CombatOccupancyService } from './combat-occupancy.service.js';
import { COMBAT_TEAM_LIMIT } from './combat.rules.js';
import { CombatService } from './combat.service.js';

export interface PvpCombatRequestOptions {
  kind?: PvpEngagementKind;
  modeKey?: PvpModeKey;
  bountyId?: string;
  normalized?: boolean;
}

interface PendingContext extends Required<Pick<PvpCombatRequestOptions, 'kind'>> {
  modeKey?: PvpModeKey;
  bountyId?: string;
  normalized?: boolean;
}

@Injectable()
export class PvpCombatIntegrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PvpCombatIntegrationService.name);
  private readonly pending = new Map<string, PendingContext>();
  private readonly settling = new Set<string>();
  private readonly replayEvents = new Map<string, Map<number, CombatSnapshot['recentActions'][number]>>();
  private unsubscribe?: () => void;

  constructor(
    private readonly combats: CombatService,
    private readonly pvp: PvpService,
    private readonly maps: MapService,
    private readonly groups: GroupService,
    private readonly trades: TradeService,
    private readonly occupancy: CombatOccupancyService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.publisher.onCombatUpdated((snapshot) => {
      void this.observeCombat(snapshot);
    });
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.pending.clear();
    this.settling.clear();
    this.replayEvents.clear();
  }

  async request(
    session: PlayerSession,
    targetCharacterId: string,
    options: PvpCombatRequestOptions = {},
  ): Promise<CombatSnapshot> {
    const target = this.requireOnline(targetCharacterId);
    const map = await this.maps.getMap(session.mapId);
    const kind = options.kind ?? (map.zoneType === 'PVP' ? 'OPEN_WORLD' : 'DUEL');
    const context: PendingContext = {
      kind,
      ...(options.modeKey ? { modeKey: options.modeKey } : {}),
      ...(options.bountyId ? { bountyId: options.bountyId } : {}),
      ...(options.normalized !== undefined ? { normalized: options.normalized } : {}),
    };

    if (map.zoneType !== 'PVP' && kind === 'DUEL') {
      const snapshot = await this.combats.request(
        session.userId,
        session.characterId,
        targetCharacterId,
      );
      this.pending.set(snapshot.combatId, context);
      return snapshot;
    }

    const parties = await this.resolveAvailableParties(session, target);
    const decision = await this.pvp.evaluateCombat(
      this.evaluationInput(map.zoneType, context, parties.attackers, parties.defenders, false),
    );
    let snapshot = await this.combats.request(
      session.userId,
      session.characterId,
      targetCharacterId,
    );

    if (snapshot.status === 'REQUESTED') {
      if (kind !== 'BOUNTY' && kind !== 'OPEN_WORLD') {
        this.pending.set(snapshot.combatId, context);
        return snapshot;
      }
      snapshot = await this.combats.respond(
        target.userId,
        target.characterId,
        snapshot.combatId,
        true,
      );
    }

    await this.recordStartedCombat(snapshot, context, decision, parties.attackers, parties.defenders);
    return snapshot;
  }

  async respond(
    session: PlayerSession,
    combatId: string,
    accept: boolean,
  ): Promise<CombatSnapshot> {
    if (!accept) {
      this.pending.delete(combatId);
      return this.combats.respond(session.userId, session.characterId, combatId, false);
    }

    const waiting = await this.combats.getActive(session.userId, session.characterId);
    if (!waiting || waiting.combatId !== combatId) {
      return this.combats.respond(session.userId, session.characterId, combatId, true);
    }
    const context = this.pending.get(combatId) ?? { kind: 'DUEL' as const };
    const parties = this.partiesFromSnapshot(waiting);
    const decision = await this.pvp.evaluateCombat(
      this.evaluationInput(waiting.zoneType, context, parties.attackers, parties.defenders, true),
    );
    const snapshot = await this.combats.respond(
      session.userId,
      session.characterId,
      combatId,
      true,
    );
    this.pending.delete(combatId);
    await this.recordStartedCombat(snapshot, context, decision, parties.attackers, parties.defenders);
    return snapshot;
  }

  private evaluationInput(
    zoneType: EvaluatePvpCombatInput['zoneType'],
    context: PendingContext,
    attackers: readonly PlayerSession[],
    defenders: readonly PlayerSession[],
    consented: boolean,
  ): EvaluatePvpCombatInput {
    return {
      zoneType,
      kind: context.kind,
      ...(context.modeKey ? { modeKey: context.modeKey } : {}),
      attackers,
      defenders,
      consented,
      ...(context.bountyId ? { bountyId: context.bountyId } : {}),
      ...(context.normalized !== undefined ? { normalized: context.normalized } : {}),
    };
  }

  private async recordStartedCombat(
    snapshot: CombatSnapshot,
    context: PendingContext,
    decision: PvpEngagementDecision,
    preflightAttackers: readonly PlayerSession[],
    preflightDefenders: readonly PlayerSession[],
  ): Promise<void> {
    if (snapshot.status !== 'ACTIVE') return;
    const actual = this.partiesFromSnapshot(snapshot);
    let approved = decision;
    if (
      !this.sameRoster(preflightAttackers, actual.attackers) ||
      !this.sameRoster(preflightDefenders, actual.defenders)
    ) {
      approved = await this.pvp.evaluateCombat(
        this.evaluationInput(
          snapshot.zoneType,
          context,
          actual.attackers,
          actual.defenders,
          context.kind === 'DUEL',
        ),
      );
    }
    try {
      await this.pvp.recordApprovedCombat({
        combatId: snapshot.combatId,
        mapId: snapshot.mapId,
        zoneType: snapshot.zoneType,
        kind: context.kind,
        ...(context.modeKey ? { modeKey: context.modeKey } : {}),
        attackers: actual.attackers,
        defenders: actual.defenders,
        consented: context.kind === 'DUEL',
        ...(context.bountyId ? { bountyId: context.bountyId } : {}),
        ...(context.normalized !== undefined ? { normalized: context.normalized } : {}),
        decision: approved,
        ...(snapshot.startedAt !== undefined ? { now: snapshot.startedAt } : {}),
      });
    } catch (error) {
      await this.abortStartedCombat(snapshot).catch(() => undefined);
      throw error;
    }
  }

  private async observeCombat(snapshot: CombatSnapshot): Promise<void> {
    if (snapshot.status === 'ACTIVE' || snapshot.status === 'FINISHED') {
      const events = this.replayEvents.get(snapshot.combatId) ?? new Map();
      for (const event of snapshot.recentActions) events.set(event.sequence, event);
      this.replayEvents.set(snapshot.combatId, events);
    }
    if (snapshot.status !== 'REQUESTED' && snapshot.status !== 'ACTIVE') {
      this.pending.delete(snapshot.combatId);
      if (snapshot.status !== 'FINISHED') this.replayEvents.delete(snapshot.combatId);
    }
    if (
      snapshot.status !== 'FINISHED' ||
      !snapshot.winnerTeamId ||
      !snapshot.finishReason ||
      snapshot.finishReason === 'SERVER_SHUTDOWN' ||
      !snapshot.teams ||
      this.settling.has(snapshot.combatId)
    ) {
      return;
    }
    this.settling.add(snapshot.combatId);
    try {
      await this.pvp.settleCombat({
        combatId: snapshot.combatId,
        winnerTeamId: snapshot.winnerTeamId,
        finishReason: snapshot.finishReason,
        teams: [
          { teamId: snapshot.teams[0].teamId, actorIds: snapshot.teams[0].actorIds },
          { teamId: snapshot.teams[1].teamId, actorIds: snapshot.teams[1].actorIds },
        ],
        events: [...(this.replayEvents.get(snapshot.combatId)?.values() ?? [])].sort(
          (left, right) => left.sequence - right.sequence,
        ),
        ...(snapshot.startedAt !== undefined ? { startedAt: snapshot.startedAt } : {}),
        ...(snapshot.finishedAt !== undefined ? { finishedAt: snapshot.finishedAt } : {}),
      });
    } catch (error) {
      this.logger.error(
        `Could not settle PvP combat ${snapshot.combatId}.`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.settling.delete(snapshot.combatId);
      this.replayEvents.delete(snapshot.combatId);
    }
  }

  private async resolveAvailableParties(
    attacker: PlayerSession,
    defender: PlayerSession,
  ): Promise<{ attackers: PlayerSession[]; defenders: PlayerSession[] }> {
    return {
      attackers: await this.resolveAvailableParty(attacker),
      defenders: await this.resolveAvailableParty(defender),
    };
  }

  private async resolveAvailableParty(anchor: PlayerSession): Promise<PlayerSession[]> {
    const group = this.groups.getSnapshot(anchor).group;
    const memberIds = group?.members.map((member) => member.characterId) ?? [anchor.characterId];
    const sessions = memberIds
      .slice(0, COMBAT_TEAM_LIMIT)
      .map((characterId) => this.world.getByCharacterId(characterId))
      .filter(
        (candidate): candidate is PlayerSession =>
          Boolean(
            candidate?.activeInWorld &&
              candidate.realmId === anchor.realmId &&
              candidate.mapId === anchor.mapId &&
              candidate.combatState === 'IDLE' &&
              !this.occupancy.isOccupied(candidate.characterId),
          ),
      );
    const tradeFlags = await Promise.all(
      sessions.map((candidate) => this.trades.hasActive(candidate.characterId)),
    );
    const available = sessions.filter((_, index) => !tradeFlags[index]);
    if (!available.some((candidate) => candidate.characterId === anchor.characterId)) {
      throw new PvpPolicyViolationError('EMPTY_TEAM');
    }
    return available;
  }

  private partiesFromSnapshot(snapshot: CombatSnapshot): {
    attackers: PlayerSession[];
    defenders: PlayerSession[];
  } {
    const firstIds = snapshot.teams?.[0].actorIds ?? [snapshot.initiatorActorId];
    const secondIds = snapshot.teams?.[1].actorIds ?? [snapshot.recipientActorId];
    return {
      attackers: firstIds.map((characterId) => this.requireOnline(characterId)),
      defenders: secondIds.map((characterId) => this.requireOnline(characterId)),
    };
  }

  private requireOnline(characterId: string): PlayerSession {
    const session = this.world.getByCharacterId(characterId);
    if (!session?.activeInWorld) throw new PvpPolicyViolationError('EMPTY_TEAM');
    return session;
  }

  private sameRoster(first: readonly PlayerSession[], second: readonly PlayerSession[]): boolean {
    return (
      first.length === second.length &&
      [...first].map((entry) => entry.characterId).sort().join(':') ===
        [...second].map((entry) => entry.characterId).sort().join(':')
    );
  }

  private async abortStartedCombat(snapshot: CombatSnapshot): Promise<void> {
    const initiator = this.world.getByCharacterId(snapshot.initiatorActorId);
    if (!initiator) return;
    await this.combats.leave(
      initiator.userId,
      initiator.characterId,
      snapshot.combatId,
    );
  }
}
