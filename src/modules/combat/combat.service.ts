import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  GAME_ERROR_CODES,
  GameError,
  type GameErrorCode,
} from '../../common/errors/game.error.js';
import {
  getPvpEngagementPolicy,
  PLAYER_INTERACTION_REQUEST_TTL_MS,
} from '../../common/rules/player-interaction-request.js';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import type { CombatSnapshot } from '../../contracts/socket.events.js';
import { GroupService } from '../groups/group.service.js';
import { MapService } from '../maps/map.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import { PlayerPersistenceService } from '../persistence/player-persistence.service.js';
import { TradeService } from '../player/trade/trade.service.js';
import { SKILL_CATALOG } from '../skills/skill.catalog.js';
import { SkillService } from '../skills/skill.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { CombatEngine } from './combat.engine.js';
import { CombatOccupancyService } from './combat-occupancy.service.js';
import {
  combatActorLockKeys,
  COMBAT_RESULT_RETENTION_MS,
  COMBAT_TEAM_LIMIT,
  isCombatDistanceAllowed,
} from './combat.rules.js';
import type {
  CombatActionCommand,
  CombatActorInput,
  CombatRuntime,
} from './combat.types.js';

interface CombatParty {
  sourceGroupId?: string;
  sessions: PlayerSession[];
}

@Injectable()
export class CombatService implements OnModuleDestroy {
  private readonly logger = new Logger(CombatService.name);
  private readonly engine = new CombatEngine();
  private readonly combats = new Map<string, CombatRuntime>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private shuttingDown = false;

  constructor(
    private readonly maps: MapService,
    private readonly movement: MovementCoordinatorService,
    private readonly persistence: PlayerPersistenceService,
    private readonly trades: TradeService,
    private readonly skills: SkillService,
    private readonly groups: GroupService,
    private readonly occupancy: CombatOccupancyService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
    private readonly executor: KeyedSerialExecutor,
  ) {}

  async getActive(
    userId: string,
    characterId: string,
  ): Promise<CombatSnapshot | null> {
    const session = this.requireOnline(characterId, userId);
    const combatId = this.occupancy.getCombatId(session.characterId);
    if (!combatId) return null;
    return this.withCombatLock(combatId, async () => {
      const runtime = this.combats.get(combatId);
      if (!runtime) return null;
      const snapshot = this.engine.reconnect(runtime, characterId, Date.now());
      this.scheduleTurn(runtime);
      return snapshot;
    });
  }

  async request(
    userId: string,
    characterId: string,
    targetCharacterId: string,
  ): Promise<CombatSnapshot> {
    if (characterId === targetCharacterId) {
      this.fail(GAME_ERROR_CODES.COMBAT_SELF, 'errors.combat.self');
    }
    const initiator = this.requireOnline(characterId, userId);
    const recipient = this.requireOnline(targetCharacterId);
    this.assertNearby(initiator, recipient);
    const [initialInitiators, initialRecipients] = await Promise.all([
      this.resolveAvailableParty(initiator),
      this.resolveAvailableParty(recipient),
    ]);
    if (this.partiesOverlap(initialInitiators, initialRecipients)) {
      this.fail(GAME_ERROR_CODES.COMBAT_FORBIDDEN, 'errors.combat.forbidden');
    }
    const lockedActorIds = [
      ...initialInitiators.sessions.map((session) => session.characterId),
      ...initialRecipients.sessions.map((session) => session.characterId),
    ];

    return this.withMovementQuiesced(
      [...initialInitiators.sessions, ...initialRecipients.sessions],
      () =>
        this.withActorLocks(lockedActorIds, async () => {
          const activeInitiator = this.requireOnline(characterId, userId);
          const activeRecipient = this.requireOnline(targetCharacterId);
          this.assertNearby(activeInitiator, activeRecipient);
          const initiatorParty = await this.revalidateFrozenParty(
            activeInitiator,
            initialInitiators,
          );
          const recipientParty = await this.revalidateFrozenParty(
            activeRecipient,
            initialRecipients,
          );
          if (this.partiesOverlap(initiatorParty, recipientParty)) {
            this.fail(GAME_ERROR_CODES.COMBAT_FORBIDDEN, 'errors.combat.forbidden');
          }

          const map = await this.maps.getMap(activeInitiator.mapId);
          const policy = getPvpEngagementPolicy(map.zoneType);
          if (policy === 'FORBIDDEN') {
            this.fail(GAME_ERROR_CODES.COMBAT_SAFE_ZONE, 'errors.combat.safeZone');
          }
          const [firstActors, secondActors] = await Promise.all([
            Promise.all(initiatorParty.sessions.map((session) => this.buildActor(session))),
            Promise.all(recipientParty.sessions.map((session) => this.buildActor(session))),
          ]);
          await this.assertNoTrades([
            ...initiatorParty.sessions,
            ...recipientParty.sessions,
          ]);

          const now = Date.now();
          const combatId = randomUUID();
          const runtime = this.engine.createRequest(
            combatId,
            map.zoneType,
            map.id,
            {
              anchorActorId: activeInitiator.characterId,
              sourceGroupId: initiatorParty.sourceGroupId,
              actors: firstActors,
            },
            {
              anchorActorId: activeRecipient.characterId,
              sourceGroupId: recipientParty.sourceGroupId,
              actors: secondActors,
            },
            now,
            now + PLAYER_INTERACTION_REQUEST_TTL_MS,
          );
          this.combats.set(combatId, runtime);
          try {
            this.occupancy.reserve(
              runtime.actors.map((actor) => actor.actorId),
              combatId,
            );
          } catch {
            this.combats.delete(combatId);
            this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
          }

          if (policy === 'IMMEDIATE') {
            const snapshot = this.activate(runtime, now);
            await this.broadcastAndPersist(runtime, snapshot, true);
            this.scheduleTurn(runtime);
            return snapshot;
          }

          this.scheduleRequestExpiry(runtime);
          const snapshot = this.engine.snapshot(runtime);
          this.publisher.emit(activeRecipient.socketId, 'combat:requested', snapshot);
          this.publisher.emit(activeInitiator.socketId, 'combat:updated', snapshot);
          this.notifyWaitingParty(
            runtime,
            initiatorParty.sessions,
            recipientParty.sessions,
          );
          return snapshot;
        }),
    );
  }

  async respond(
    userId: string,
    characterId: string,
    combatId: string,
    accept: boolean,
  ): Promise<CombatSnapshot> {
    return this.withCombatLock(combatId, async () => {
      const runtime = this.requireRuntime(combatId);
      const session = this.requireParticipant(runtime, characterId, userId);
      if (runtime.recipientActorId !== session.characterId) {
        this.fail(GAME_ERROR_CODES.COMBAT_FORBIDDEN, 'errors.combat.forbidden');
      }
      if (runtime.status !== 'REQUESTED') {
        this.fail(GAME_ERROR_CODES.COMBAT_NOT_ACTIVE, 'errors.combat.notActive');
      }
      if ((runtime.expiresAt ?? 0) <= Date.now()) {
        const expired = this.engine.decline(runtime, 'REQUEST_EXPIRED', Date.now());
        this.releaseActors(runtime);
        await this.broadcastAndPersist(runtime, expired, false);
        this.scheduleCleanup(runtime);
        return expired;
      }
      if (!accept) {
        const declined = this.engine.decline(runtime, 'DECLINED', Date.now());
        this.releaseActors(runtime);
        await this.broadcastAndPersist(runtime, declined, false);
        this.scheduleCleanup(runtime);
        return declined;
      }

      const participants = runtime.actors
        .filter((actor) => actor.characterId)
        .map((actor) => this.requireOnline(actor.characterId!));
      return this.withMovementQuiesced(participants, async () => {
        await this.assertFrozenRoster(runtime);
        for (const participant of participants) {
          this.assertAvailable(participant, combatId);
        }
        await this.assertNoTrades(participants);
        const initiator = this.requireOnline(runtime.initiatorActorId);
        const recipient = this.requireOnline(runtime.recipientActorId);
        this.assertNearby(initiator, recipient);
        const snapshot = this.activate(runtime, Date.now());
        await this.broadcastAndPersist(runtime, snapshot, true);
        this.scheduleTurn(runtime);
        return snapshot;
      });
    });
  }

  async act(
    userId: string,
    characterId: string,
    combatId: string,
    command: CombatActionCommand,
  ): Promise<CombatSnapshot> {
    return this.withCombatLock(combatId, () =>
      this.resolveAction(userId, characterId, combatId, command),
    );
  }

  async leave(
    userId: string,
    characterId: string,
    combatId: string,
  ): Promise<CombatSnapshot> {
    return this.withCombatLock(combatId, async () => {
      const runtime = this.requireRuntime(combatId);
      this.requireParticipant(runtime, characterId, userId);
      const snapshot = this.engine.forfeit(runtime, characterId, Date.now());
      this.releaseActor(runtime, characterId);
      const terminal = runtime.status !== 'ACTIVE';
      if (terminal) this.releaseActors(runtime);
      await this.broadcastAndPersist(runtime, snapshot, true);
      if (terminal) this.scheduleCleanup(runtime);
      else this.scheduleTurn(runtime);
      return snapshot;
    });
  }

  async handleDisconnect(characterId: string): Promise<void> {
    const combatId = this.occupancy.getCombatId(characterId);
    if (!combatId) return;
    await this.withCombatLock(combatId, async () => {
      const runtime = this.combats.get(combatId);
      if (!runtime || !runtime.actors.some((actor) => actor.actorId === characterId)) {
        return;
      }
      if (runtime.status !== 'ACTIVE') {
        const cancelled = this.engine.decline(runtime, 'CANCELLED', Date.now());
        this.releaseActors(runtime);
        await this.broadcastAndPersist(runtime, cancelled, false);
        this.scheduleCleanup(runtime);
        return;
      }
      const snapshot = this.engine.disconnect(runtime, characterId, Date.now());
      await this.broadcastAndPersist(runtime, snapshot, true);
      this.scheduleTurn(runtime);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const runtime of this.combats.values()) {
      if (!['ACTIVE', 'REQUESTED'].includes(runtime.status)) continue;
      const snapshot =
        runtime.status === 'ACTIVE'
          ? this.engine.terminate(runtime, 'SERVER_SHUTDOWN', Date.now())
          : this.engine.decline(runtime, 'CANCELLED', Date.now());
      this.releaseActors(runtime);
      await this.broadcastAndPersist(runtime, snapshot, true);
    }
    await this.executor.drain();
  }

  private async resolveAction(
    userId: string | undefined,
    characterId: string,
    combatId: string,
    command: CombatActionCommand,
  ): Promise<CombatSnapshot> {
    const runtime = this.requireRuntime(combatId);
    if (userId) this.requireParticipant(runtime, characterId, userId);
    let snapshot: CombatSnapshot;
    try {
      snapshot = this.engine.act(runtime, characterId, command, Date.now());
    } catch (error) {
      this.rethrowEngineError(error);
    }
    await this.afterResolution(runtime, snapshot, true);
    return snapshot;
  }

  private async afterResolution(
    runtime: CombatRuntime,
    snapshot: CombatSnapshot,
    checkpoint: boolean,
  ): Promise<void> {
    if (runtime.status === 'FINISHED') this.releaseActors(runtime);
    await this.broadcastAndPersist(runtime, snapshot, checkpoint);
    if (runtime.status === 'FINISHED') this.scheduleCleanup(runtime);
    else this.scheduleTurn(runtime);
  }

  private activate(runtime: CombatRuntime, now: number): CombatSnapshot {
    const snapshot = this.engine.start(runtime, now);
    this.syncRuntimeToWorld(runtime);
    return snapshot;
  }

  private async resolveAvailableParty(anchor: PlayerSession): Promise<CombatParty> {
    const group = this.groups.getSnapshot(anchor).group;
    const sourceGroupId = group?.id;
    const memberIds =
      group?.members.map((member) => member.characterId) ?? [anchor.characterId];
    const sessions = memberIds
      .slice(0, COMBAT_TEAM_LIMIT)
      .map((characterId) => this.world.getByCharacterId(characterId))
      .filter(
        (session): session is PlayerSession =>
          Boolean(
            session?.activeInWorld &&
              session.realmId === anchor.realmId &&
              session.mapId === anchor.mapId &&
              session.combatState === 'IDLE' &&
              !this.occupancy.isOccupied(session.characterId),
          ),
      );
    const tradeFlags = await Promise.all(
      sessions.map((session) => this.trades.hasActive(session.characterId)),
    );
    const available = sessions.filter((_, index) => !tradeFlags[index]);
    if (!available.some((session) => session.characterId === anchor.characterId)) {
      this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
    }
    return { sourceGroupId, sessions: available };
  }

  private async revalidateFrozenParty(
    anchor: PlayerSession,
    party: CombatParty,
  ): Promise<CombatParty> {
    const currentGroup = this.groups.getSnapshot(anchor).group;
    if ((currentGroup?.id ?? undefined) !== party.sourceGroupId) {
      this.fail(
        GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
        'errors.combat.participantUnavailable',
      );
    }
    const currentIds = new Set(
      currentGroup?.members.map((member) => member.characterId) ?? [anchor.characterId],
    );
    const sessions = party.sessions.map((original) => {
      if (!currentIds.has(original.characterId)) {
        this.fail(
          GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
          'errors.combat.participantUnavailable',
        );
      }
      const session = this.requireOnline(original.characterId);
      if (session.realmId !== anchor.realmId || session.mapId !== anchor.mapId) {
        this.fail(
          GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
          'errors.combat.participantUnavailable',
        );
      }
      this.assertAvailable(session);
      return session;
    });
    await this.assertNoTrades(sessions);
    return { sourceGroupId: party.sourceGroupId, sessions };
  }

  private async assertFrozenRoster(runtime: CombatRuntime): Promise<void> {
    for (const team of runtime.teams) {
      const anchor = this.requireOnline(team.anchorActorId);
      const group = this.groups.getSnapshot(anchor).group;
      if ((group?.id ?? undefined) !== team.sourceGroupId) {
        this.fail(
          GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
          'errors.combat.participantUnavailable',
        );
      }
      const currentIds = new Set(
        group?.members.map((member) => member.characterId) ?? [anchor.characterId],
      );
      for (const actorId of team.actorIds) {
        if (!currentIds.has(actorId)) {
          this.fail(
            GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
            'errors.combat.participantUnavailable',
          );
        }
        const participant = this.requireOnline(actorId);
        if (
          participant.realmId !== anchor.realmId ||
          participant.mapId !== anchor.mapId
        ) {
          this.fail(
            GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
            'errors.combat.participantUnavailable',
          );
        }
      }
    }
  }

  private partiesOverlap(first: CombatParty, second: CombatParty): boolean {
    if (first.sourceGroupId && first.sourceGroupId === second.sourceGroupId) return true;
    const ids = new Set(first.sessions.map((session) => session.characterId));
    return second.sessions.some((session) => ids.has(session.characterId));
  }

  private async assertNoTrades(sessions: readonly PlayerSession[]): Promise<void> {
    const active = await Promise.all(
      sessions.map((session) => this.trades.hasActive(session.characterId)),
    );
    if (active.some(Boolean)) {
      this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
    }
  }

  private notifyWaitingParty(
    runtime: CombatRuntime,
    initiators: PlayerSession[],
    recipients: PlayerSession[],
  ): void {
    for (const session of [...initiators, ...recipients]) {
      if (
        session.characterId === runtime.initiatorActorId ||
        session.characterId === runtime.recipientActorId
      ) {
        continue;
      }
      this.publisher.emit(session.socketId, 'notification', {
        code: 'GROUP_COMBAT_PENDING',
        message:
          session.locale === 'pl'
            ? 'Twoja grupa została przypisana do oczekującej walki.'
            : 'Your group has been assigned to a pending combat.',
      });
    }
  }

  private async buildActor(session: PlayerSession): Promise<CombatActorInput> {
    const tree = await this.skills.getSnapshot(session.userId, session.characterId);
    const learned = tree.skills
      .filter((skill) => skill.rank > 0)
      .flatMap((skill) => {
        const definition = SKILL_CATALOG.find((candidate) => candidate.key === skill.key);
        return definition
          ? [{ definition, cooldownTurnsRemaining: skill.cooldownTurnsRemaining }]
          : [];
      });
    return {
      actorId: session.characterId,
      kind: 'PLAYER',
      characterId: session.characterId,
      name: session.name,
      characterClass: session.characterClass,
      level: session.level,
      outfitKey: session.outfitKey,
      hp: Math.max(1, session.hp),
      maxHp: session.maxHp,
      energy: session.energy,
      maxEnergy: session.maxEnergy,
      strength: session.strength,
      agility: session.agility,
      intelligence: session.intelligence,
      armor: session.armor,
      skills: learned,
    };
  }

  private syncRuntimeToWorld(runtime: CombatRuntime): PlayerSession[] {
    const sessions: PlayerSession[] = [];
    for (const actor of runtime.actors) {
      if (!actor.characterId) continue;
      const session = this.world.getByCharacterId(actor.characterId);
      if (!session) continue;
      const stillFighting = runtime.status === 'ACTIVE' && !actor.withdrawn;
      const combatState = stillFighting ? 'IN_BATTLE' : 'IDLE';
      const hp = stillFighting ? actor.hp : Math.max(1, actor.hp);
      if (
        session.combatState !== combatState ||
        session.hp !== hp ||
        session.energy !== actor.energy
      ) {
        session.combatState = combatState;
        session.hp = hp;
        session.energy = actor.energy;
        session.stateRevision += 1;
        session.dirty = true;
      }
      sessions.push(session);
      this.publishPublicState(session);
    }
    return sessions;
  }

  private async broadcastAndPersist(
    runtime: CombatRuntime,
    snapshot: CombatSnapshot,
    checkpoint: boolean,
  ): Promise<void> {
    const sessions = this.syncRuntimeToWorld(runtime);
    for (const session of sessions) {
      this.publisher.emit(session.socketId, 'combat:updated', snapshot);
    }
    await Promise.all(
      runtime.actors.flatMap((actor) => {
        if (!actor.characterId) return [];
        const cooldowns = Object.fromEntries(
          [...actor.skills].map(([key, skill]) => [key, skill.cooldownTurnsRemaining]),
        );
        return [
          this.skills.persistCooldowns(actor.characterId, cooldowns).catch((error: unknown) => {
            this.logger.error(
              `Could not persist combat cooldowns for ${actor.characterId}.`,
              error instanceof Error ? error.stack : undefined,
            );
          }),
        ];
      }),
    );
    if (!checkpoint) return;
    await Promise.all(
      sessions.map(async (session) => {
        try {
          const persisted = await this.persistence.persistSession(session, 'combat');
          this.world.markPersisted(
            persisted.characterId,
            persisted.connectionId,
            persisted.revision,
          );
        } catch (error) {
          this.logger.error(
            `Could not checkpoint combat state for ${session.characterId}.`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }),
    );
  }

  private publishPublicState(session: PlayerSession): void {
    const payload = { ...this.world.toPublicState(session), serverTime: Date.now() };
    for (const watcherId of session.watcherCharacterIds) {
      const watcher = this.world.getByCharacterId(watcherId);
      if (watcher?.activeInWorld) {
        this.publisher.emit(watcher.socketId, 'world:playerMoved', payload);
      }
    }
  }

  private scheduleRequestExpiry(runtime: CombatRuntime): void {
    this.setTimer(
      runtime.combatId,
      Math.max(1, (runtime.expiresAt ?? Date.now()) - Date.now()),
      () => void this.expireRequest(runtime.combatId),
    );
  }

  private async expireRequest(combatId: string): Promise<void> {
    await this.withCombatLock(combatId, async () => {
      const runtime = this.combats.get(combatId);
      if (!runtime || runtime.status !== 'REQUESTED') return;
      const snapshot = this.engine.decline(runtime, 'REQUEST_EXPIRED', Date.now());
      this.releaseActors(runtime);
      await this.broadcastAndPersist(runtime, snapshot, false);
      this.scheduleCleanup(runtime);
    });
  }

  private scheduleTurn(runtime: CombatRuntime): void {
    if (runtime.status !== 'ACTIVE' || !runtime.activeActorId || !runtime.turnEndsAt) {
      return;
    }
    const expectedActorId = runtime.activeActorId;
    const expectedTurn = runtime.turnNumber;
    const expectedPhase = runtime.phase;
    this.setTimer(runtime.combatId, Math.max(1, runtime.turnEndsAt - Date.now()), () => {
      void this.withCombatLock(runtime.combatId, async () => {
        const current = this.combats.get(runtime.combatId);
        if (
          !current ||
          current.status !== 'ACTIVE' ||
          current.activeActorId !== expectedActorId ||
          current.turnNumber !== expectedTurn ||
          current.phase !== expectedPhase
        ) {
          return;
        }
        const now = Date.now();
        let snapshot: CombatSnapshot;
        if (current.phase === 'REACTION') {
          snapshot = this.engine.resolveTelegraph(current, now);
        } else if (
          this.engine.isDisconnectGraceExpired(current, expectedActorId, now)
        ) {
          snapshot = this.engine.forfeit(
            current,
            expectedActorId,
            now,
            'DISCONNECTED',
          );
          this.releaseActor(current, expectedActorId);
        } else {
          snapshot = this.engine.timeout(current, expectedActorId, now);
        }
        await this.afterResolution(current, snapshot, true);
      });
    });
  }

  private scheduleCleanup(runtime: CombatRuntime): void {
    this.setTimer(runtime.combatId, COMBAT_RESULT_RETENTION_MS, () => {
      this.combats.delete(runtime.combatId);
      this.timers.delete(runtime.combatId);
    });
  }

  private setTimer(combatId: string, delay: number, callback: () => void): void {
    const previous = this.timers.get(combatId);
    if (previous) clearTimeout(previous);
    if (this.shuttingDown) return;
    const timer = setTimeout(callback, delay);
    timer.unref?.();
    this.timers.set(combatId, timer);
  }

  private releaseActor(runtime: CombatRuntime, actorId: string): void {
    this.occupancy.release(actorId, runtime.combatId);
  }

  private releaseActors(runtime: CombatRuntime): void {
    const timer = this.timers.get(runtime.combatId);
    if (timer) clearTimeout(timer);
    this.timers.delete(runtime.combatId);
    for (const actor of runtime.actors) this.releaseActor(runtime, actor.actorId);
  }

  private requireRuntime(combatId: string): CombatRuntime {
    const runtime = this.combats.get(combatId);
    if (!runtime) {
      this.fail(GAME_ERROR_CODES.COMBAT_NOT_FOUND, 'errors.combat.notFound');
    }
    return runtime;
  }

  private requireParticipant(
    runtime: CombatRuntime,
    characterId: string,
    userId: string,
  ): PlayerSession {
    if (!runtime.actors.some((actor) => actor.characterId === characterId)) {
      this.fail(GAME_ERROR_CODES.COMBAT_FORBIDDEN, 'errors.combat.forbidden');
    }
    return this.requireOnline(characterId, userId);
  }

  private requireOnline(characterId: string, userId?: string): PlayerSession {
    const session = this.world.getByCharacterId(characterId);
    if (!session?.activeInWorld || (userId && session.userId !== userId)) {
      this.fail(
        GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
        'errors.combat.participantUnavailable',
      );
    }
    return session;
  }

  private assertAvailable(session: PlayerSession, expectedCombatId?: string): void {
    const combatId = this.occupancy.getCombatId(session.characterId);
    if (
      session.combatState !== 'IDLE' ||
      (combatId !== undefined && combatId !== expectedCombatId)
    ) {
      this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
    }
  }

  private assertNearby(first: PlayerSession, second: PlayerSession): void {
    if (first.realmId !== second.realmId || !isCombatDistanceAllowed(first, second)) {
      this.fail(GAME_ERROR_CODES.COMBAT_TOO_FAR, 'errors.combat.tooFar');
    }
  }

  private withCombatLock<T>(combatId: string, task: () => Promise<T>): Promise<T> {
    return this.executor.run(`combat-session:${combatId}`, task);
  }

  private withActorLocks<T>(actorIds: Iterable<string>, task: () => Promise<T>): Promise<T> {
    const keys = combatActorLockKeys(actorIds);
    const acquire = (index: number): Promise<T> =>
      index >= keys.length
        ? task()
        : this.executor.run(keys[index]!, () => acquire(index + 1));
    return acquire(0);
  }

  private withMovementQuiesced<T>(
    sessions: readonly PlayerSession[],
    task: () => Promise<T>,
  ): Promise<T> {
    const ordered = [...sessions].sort((a, b) =>
      a.characterId.localeCompare(b.characterId),
    );
    const acquire = (index: number): Promise<T> =>
      index >= ordered.length
        ? task()
        : this.movement.quiesce(ordered[index]!, () => acquire(index + 1));
    return acquire(0);
  }

  private rethrowEngineError(error: unknown): never {
    const code = error instanceof Error ? error.message : '';
    const mapping: Partial<Record<string, [GameErrorCode, string]>> = {
      COMBAT_NOT_ACTIVE: [
        GAME_ERROR_CODES.COMBAT_NOT_ACTIVE,
        'errors.combat.notActive',
      ],
      COMBAT_NOT_YOUR_TURN: [
        GAME_ERROR_CODES.COMBAT_NOT_YOUR_TURN,
        'errors.combat.notYourTurn',
      ],
      COMBAT_SKILL_NOT_LEARNED: [
        GAME_ERROR_CODES.COMBAT_SKILL_NOT_LEARNED,
        'errors.combat.skillNotLearned',
      ],
      COMBAT_SKILL_COOLDOWN: [
        GAME_ERROR_CODES.COMBAT_SKILL_COOLDOWN,
        'errors.combat.skillCooldown',
      ],
      COMBAT_INSUFFICIENT_ENERGY: [
        GAME_ERROR_CODES.COMBAT_INSUFFICIENT_ENERGY,
        'errors.combat.insufficientEnergy',
      ],
      COMBAT_ACTION_INVALID: [
        GAME_ERROR_CODES.COMBAT_ACTION_INVALID,
        'errors.combat.actionInvalid',
      ],
      COMBAT_OPERATION_CONFLICT: [
        GAME_ERROR_CODES.COMBAT_ACTION_INVALID,
        'errors.combat.actionInvalid',
      ],
      COMBAT_STALE_TURN: [
        GAME_ERROR_CODES.COMBAT_NOT_YOUR_TURN,
        'errors.combat.notYourTurn',
      ],
      COMBAT_CONTRACT_UNSUPPORTED: [
        GAME_ERROR_CODES.COMBAT_ACTION_INVALID,
        'errors.combat.actionInvalid',
      ],
      COMBAT_FORBIDDEN: [
        GAME_ERROR_CODES.COMBAT_FORBIDDEN,
        'errors.combat.forbidden',
      ],
    };
    const match = mapping[code];
    if (match) this.fail(match[0], match[1]);
    throw error;
  }

  private fail(code: GameErrorCode, messageKey: string): never {
    throw new GameError(code, messageKey as never);
  }
}
