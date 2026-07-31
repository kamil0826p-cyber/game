import { Injectable, Logger } from '@nestjs/common';
import type { CombatSnapshot, GameSocket } from '../contracts/socket.events.js';
import { DomainEventService } from '../domain-events/domain-event.service.js';
import type { DomainEventInput } from '../domain-events/domain-event.types.js';
import type { PlayerSession } from '../modules/world/player-session.types.js';

function safeVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.normalize('NFKC').trim();
  return /^[A-Za-z0-9._+-]{1,64}$/.test(normalized) ? normalized : undefined;
}

function clientVersion(client: GameSocket): string | undefined {
  return safeVersion(client.handshake.auth?.clientVersion) ??
    safeVersion(client.handshake.query.clientVersion) ??
    safeVersion(client.handshake.headers['x-client-version']);
}

function participantFacts(snapshot: CombatSnapshot): Array<Record<string, unknown>> {
  return snapshot.participants.map((participant) => ({
    actorId: participant.actorId,
    teamId: participant.teamId,
    withdrawn: participant.withdrawn,
    ...(participant.characterId ? { characterId: participant.characterId } : {}),
    kind: participant.kind,
    characterClass: participant.characterClass,
    level: participant.level,
    hp: participant.hp,
    maxHp: participant.maxHp,
  }));
}

function combatMode(snapshot: CombatSnapshot): 'PVE' | 'PVP' {
  return snapshot.participants.some((participant) => participant.kind === 'MOB') ? 'PVE' : 'PVP';
}

function combatDifficultyLevel(snapshot: CombatSnapshot): number | undefined {
  const mobLevels = snapshot.participants
    .filter((participant) => participant.kind === 'MOB')
    .map((participant) => participant.level);
  return mobLevels.length > 0 ? Math.max(...mobLevels) : undefined;
}

@Injectable()
export class AnalyticsTrackingService {
  private readonly logger = new Logger(AnalyticsTrackingService.name);

  constructor(private readonly events: DomainEventService) {}

  sessionStarted(client: GameSocket): Promise<void> {
    const accountId = client.data.userId;
    if (!accountId) return Promise.resolve();
    const version = clientVersion(client);
    return this.bestEffort({
      operationId: `session-start:${client.id}`,
      type: 'SessionStarted',
      payload: {
        accountId,
        sessionId: client.id,
        ...(version ? { clientVersion: version } : {}),
        ...(client.data.locale ? { locale: client.data.locale } : {}),
      },
    });
  }

  sessionEnded(client: GameSocket, session?: PlayerSession, reason = 'DISCONNECT'): Promise<void> {
    const accountId = client.data.userId ?? session?.userId;
    if (!accountId) return Promise.resolve();
    const version = clientVersion(client);
    return this.bestEffort({
      operationId: `session-end:${client.id}`,
      type: 'SessionEnded',
      actorCharacterId: session?.characterId,
      realmId: session?.realmId,
      mapId: session?.mapId,
      payload: {
        accountId,
        sessionId: client.id,
        ...(version ? { clientVersion: version } : {}),
        reason,
        ...(session ? { durationMs: Math.max(0, Date.now() - session.connectedAt) } : {}),
      },
    });
  }

  regionEntered(session: PlayerSession, source: 'WORLD_ENTRY' | 'PORTAL', sourceMapId?: string): Promise<void> {
    return this.bestEffort({
      operationId: `region-enter:${session.connectionId}:${session.stateRevision}:${session.mapId}`,
      type: 'RegionEntered',
      actorCharacterId: session.characterId,
      realmId: session.realmId,
      mapId: session.mapId,
      payload: {
        accountId: session.userId,
        characterId: session.characterId,
        sessionId: session.socketId,
        regionKey: session.mapId,
        source,
        ...(sourceMapId ? { sourceMapId } : {}),
      },
    });
  }

  groupJoined(session: PlayerSession, groupId: string, memberCount: number): Promise<void> {
    return this.bestEffort({
      operationId: `group-joined:${groupId}:${session.characterId}`,
      type: 'GroupJoined',
      actorCharacterId: session.characterId,
      realmId: session.realmId,
      mapId: session.mapId,
      payload: {
        accountId: session.userId,
        characterId: session.characterId,
        sessionId: session.socketId,
        groupId,
        memberCount,
      },
    });
  }

  combatStarted(session: PlayerSession, snapshot: CombatSnapshot): Promise<void> {
    const startedAt = snapshot.startedAt ?? Date.now();
    const difficultyLevel = combatDifficultyLevel(snapshot);
    return this.bestEffort({
      operationId: `combat-start:${snapshot.combatId}:${session.characterId}`,
      type: 'CombatStarted',
      actorCharacterId: session.characterId,
      realmId: session.realmId,
      mapId: snapshot.mapId,
      occurredAt: new Date(startedAt),
      payload: {
        accountId: session.userId,
        characterId: session.characterId,
        sessionId: session.socketId,
        combatId: snapshot.combatId,
        startedAt,
        zoneType: snapshot.zoneType,
        mode: combatMode(snapshot),
        ...(difficultyLevel !== undefined ? { difficultyLevel } : {}),
        participants: participantFacts(snapshot),
      },
    });
  }

  combatActionAccepted(
    session: PlayerSession,
    snapshot: CombatSnapshot,
    command: { action: 'BASIC_ATTACK' | 'SKILL'; skillKey?: string; targetActorId?: string },
  ): Promise<void> {
    const resolution = [...snapshot.recentActions].reverse().find((candidate) =>
      candidate.actorId === session.characterId &&
      candidate.action === command.action &&
      (command.action !== 'SKILL' || candidate.skillKey === command.skillKey));
    if (!resolution) {
      this.logger.warn(`Accepted combat action for ${snapshot.combatId} had no matching server resolution.`);
      return Promise.resolve();
    }
    return this.bestEffort({
      operationId: `combat-action:${snapshot.combatId}:${resolution.sequence}`,
      type: 'CombatActionAccepted',
      actorCharacterId: session.characterId,
      realmId: session.realmId,
      mapId: snapshot.mapId,
      occurredAt: new Date(resolution.occurredAt),
      payload: {
        accountId: session.userId,
        characterId: session.characterId,
        sessionId: session.socketId,
        combatId: snapshot.combatId,
        sequence: resolution.sequence,
        turnNumber: snapshot.turnNumber,
        action: resolution.action,
        ...(resolution.skillKey ? { skillKey: resolution.skillKey } : {}),
        ...(resolution.targetActorId ? { targetActorId: resolution.targetActorId } : {}),
        results: resolution.results.map((result) => ({
          targetActorId: result.targetActorId,
          hpDelta: result.hpDelta,
          energyDelta: result.energyDelta,
          shieldAbsorbed: result.shieldAbsorbed,
          dodged: result.dodged,
          statusesApplied: result.statusesApplied.map((status) => status.key),
        })),
      },
    });
  }

  combatResolved(session: PlayerSession, snapshot: CombatSnapshot): Promise<void> {
    const startedAt = snapshot.startedAt ?? snapshot.createdAt;
    const finishedAt = snapshot.finishedAt ?? Date.now();
    const difficultyLevel = combatDifficultyLevel(snapshot);
    return this.bestEffort({
      operationId: `combat-resolved:${snapshot.combatId}`,
      type: 'CombatResolved',
      actorCharacterId: session.characterId,
      realmId: session.realmId,
      mapId: snapshot.mapId,
      occurredAt: new Date(finishedAt),
      payload: {
        accountId: session.userId,
        characterId: session.characterId,
        sessionId: session.socketId,
        combatId: snapshot.combatId,
        finishReason: snapshot.finishReason ?? 'UNKNOWN',
        ...(snapshot.winnerActorId ? { winnerActorId: snapshot.winnerActorId } : {}),
        durationMs: Math.max(0, finishedAt - startedAt),
        turns: snapshot.turnNumber,
        participantCount: snapshot.participants.length,
        zoneType: snapshot.zoneType,
        mode: combatMode(snapshot),
        ...(difficultyLevel !== undefined ? { difficultyLevel } : {}),
        participants: participantFacts(snapshot),
      },
    });
  }

  combatDisconnected(session: PlayerSession, snapshot: CombatSnapshot): Promise<void> {
    return this.bestEffort({
      operationId: `combat-disconnected:${snapshot.combatId}:${session.characterId}`,
      type: 'CombatDisconnected',
      actorCharacterId: session.characterId,
      realmId: session.realmId,
      mapId: snapshot.mapId,
      payload: {
        accountId: session.userId,
        characterId: session.characterId,
        sessionId: session.socketId,
        combatId: snapshot.combatId,
        turnNumber: snapshot.turnNumber,
      },
    });
  }

  onboardingCheckpoint(input: {
    session: PlayerSession;
    journeyVersion: number;
    checkpointKey: string;
    skipped?: boolean;
    errorCode?: string;
  }): Promise<void> {
    return this.bestEffort({
      operationId: `onboarding:${input.journeyVersion}:${input.checkpointKey}:${input.session.characterId}`,
      type: 'OnboardingCheckpointReached',
      actorCharacterId: input.session.characterId,
      realmId: input.session.realmId,
      mapId: input.session.mapId,
      payload: {
        accountId: input.session.userId,
        characterId: input.session.characterId,
        sessionId: input.session.socketId,
        journeyVersion: input.journeyVersion,
        checkpointKey: input.checkpointKey,
        skipped: input.skipped ?? false,
        ...(input.errorCode ? { errorCode: input.errorCode } : {}),
      },
    });
  }

  private async bestEffort(input: DomainEventInput): Promise<void> {
    try {
      await this.events.appendInTransaction(input);
    } catch (error) {
      this.logger.warn(
        `Analytics fact ${input.type} could not be appended; gameplay remains authoritative. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
