import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError, type GameErrorCode } from '../../common/errors/game.error.js';
import {
  getPvpEngagementPolicy,
  PLAYER_INTERACTION_REQUEST_TTL_MS,
} from '../../common/rules/player-interaction-request.js';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import type { CombatSnapshot } from '../../contracts/socket.events.js';
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
import {
  combatActorLockKeys,
  COMBAT_RESULT_RETENTION_MS,
  isCombatDistanceAllowed,
} from './combat.rules.js';
import type { CombatActionCommand, CombatActorInput, CombatRuntime } from './combat.types.js';

@Injectable()
export class CombatService implements OnModuleDestroy {
  private readonly logger = new Logger(CombatService.name);
  private readonly engine = new CombatEngine();
  private readonly combats = new Map<string, CombatRuntime>();
  private readonly combatByActor = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private shuttingDown = false;

  constructor(
    private readonly maps: MapService,
    private readonly movement: MovementCoordinatorService,
    private readonly persistence: PlayerPersistenceService,
    private readonly trades: TradeService,
    private readonly skills: SkillService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
    private readonly executor: KeyedSerialExecutor,
  ) {}

  getActive(userId: string, characterId: string): CombatSnapshot | null {
    const session = this.requireOnline(characterId, userId);
    const combatId = this.combatByActor.get(session.characterId);
    if (!combatId) return null;
    const runtime = this.combats.get(combatId);
    return runtime ? this.engine.snapshot(runtime) : null;
  }

  async request(
    userId: string,
    characterId: string,
    targetCharacterId: string,
  ): Promise<CombatSnapshot> {
    if (characterId === targetCharacterId)
      this.fail(GAME_ERROR_CODES.COMBAT_SELF, 'errors.combat.self');
    const initiator = this.requireOnline(characterId, userId);
    const recipient = this.requireOnline(targetCharacterId);

    return this.withMovementQuiesced([initiator, recipient], () =>
      this.withActorLocks(characterId, targetCharacterId, async () => {
        const activeInitiator = this.requireOnline(characterId, userId);
        const activeRecipient = this.requireOnline(targetCharacterId);
        this.assertAvailable(activeInitiator);
        this.assertAvailable(activeRecipient);
        this.assertNearby(activeInitiator, activeRecipient);

        const map = await this.maps.getMap(activeInitiator.mapId);
        const policy = getPvpEngagementPolicy(map.zoneType);
        if (policy === 'FORBIDDEN')
          this.fail(GAME_ERROR_CODES.COMBAT_SAFE_ZONE, 'errors.combat.safeZone');
        if (
          (await this.trades.hasActive(activeInitiator.characterId)) ||
          (await this.trades.hasActive(activeRecipient.characterId))
        )
          this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');

        const [first, second] = await Promise.all([
          this.buildActor(activeInitiator),
          this.buildActor(activeRecipient),
        ]);
        if (
          (await this.trades.hasActive(activeInitiator.characterId)) ||
          (await this.trades.hasActive(activeRecipient.characterId))
        )
          this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
        const now = Date.now();
        const combatId = randomUUID();
        const runtime = this.engine.createRequest(
          combatId,
          map.zoneType,
          map.id,
          first,
          second,
          now,
          now + PLAYER_INTERACTION_REQUEST_TTL_MS,
        );
        this.combats.set(combatId, runtime);
        this.combatByActor.set(first.actorId, combatId);
        this.combatByActor.set(second.actorId, combatId);

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
      if (runtime.recipientActorId !== session.characterId)
        this.fail(GAME_ERROR_CODES.COMBAT_FORBIDDEN, 'errors.combat.forbidden');
      if (runtime.status !== 'REQUESTED')
        this.fail(GAME_ERROR_CODES.COMBAT_NOT_ACTIVE, 'errors.combat.notActive');
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

      const participants = runtime.actors.map((actor) =>
        this.requireOnline(actor.characterId!),
      ) as [PlayerSession, PlayerSession];
      return this.withMovementQuiesced(participants, async () => {
        const [initiator, recipient] = participants.map((participant) =>
          this.requireOnline(participant.characterId),
        ) as [PlayerSession, PlayerSession];
        this.assertAvailable(initiator, combatId);
        this.assertAvailable(recipient, combatId);
        this.assertNearby(initiator, recipient);
        if (
          (await this.trades.hasActive(initiator.characterId)) ||
          (await this.trades.hasActive(recipient.characterId))
        )
          this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');

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

  async leave(userId: string, characterId: string, combatId: string): Promise<CombatSnapshot> {
    return this.withCombatLock(combatId, async () => {
      const runtime = this.requireRuntime(combatId);
      this.requireParticipant(runtime, characterId, userId);
      const snapshot = this.engine.forfeit(runtime, characterId, Date.now());
      this.releaseActors(runtime);
      await this.broadcastAndPersist(runtime, snapshot, runtime.status === 'FINISHED');
      this.scheduleCleanup(runtime);
      return snapshot;
    });
  }

  async handleDisconnect(characterId: string): Promise<void> {
    const combatId = this.combatByActor.get(characterId);
    if (!combatId) return;
    await this.withCombatLock(combatId, async () => {
      const runtime = this.combats.get(combatId);
      if (!runtime || !runtime.actors.some((actor) => actor.actorId === characterId)) return;
      const snapshot =
        runtime.status === 'ACTIVE'
          ? this.engine.forfeit(runtime, characterId, Date.now(), 'DISCONNECTED')
          : this.engine.decline(runtime, 'CANCELLED', Date.now());
      this.releaseActors(runtime);
      await this.broadcastAndPersist(runtime, snapshot, runtime.status === 'FINISHED');
      this.scheduleCleanup(runtime);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const runtime of this.combats.values()) {
      if (runtime.status !== 'ACTIVE') continue;
      const loser = runtime.activeActorId ?? runtime.initiatorActorId;
      const snapshot = this.engine.forfeit(runtime, loser, Date.now(), 'SERVER_SHUTDOWN');
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
    if (runtime.status === 'FINISHED') this.releaseActors(runtime);
    await this.broadcastAndPersist(runtime, snapshot, true);
    if (runtime.status === 'FINISHED') this.scheduleCleanup(runtime);
    else this.scheduleTurn(runtime);
    return snapshot;
  }

  private activate(runtime: CombatRuntime, now: number): CombatSnapshot {
    const snapshot = this.engine.start(runtime, now);
    this.syncRuntimeToWorld(runtime);
    return snapshot;
  }

  private async buildActor(session: PlayerSession): Promise<CombatActorInput> {
    const tree = await this.skills.getSnapshot(session.userId, session.characterId);
    const learned = tree.skills
      .filter((skill) => skill.rank > 0)
      .map((skill) => {
        const definition = SKILL_CATALOG.find((candidate) => candidate.key === skill.key);
        if (!definition) return undefined;
        return {
          definition,
          cooldownTurnsRemaining: skill.cooldownTurnsRemaining,
        };
      })
      .filter((skill): skill is NonNullable<typeof skill> => Boolean(skill));
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
      const combatState = runtime.status === 'ACTIVE' ? 'IN_BATTLE' : 'IDLE';
      const hp = runtime.status === 'FINISHED' ? Math.max(1, actor.hp) : actor.hp;
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
    for (const session of sessions)
      this.publisher.emit(session.socketId, 'combat:updated', snapshot);

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
      if (watcher?.activeInWorld)
        this.publisher.emit(watcher.socketId, 'world:playerMoved', payload);
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
    if (runtime.status !== 'ACTIVE' || !runtime.activeActorId || !runtime.turnEndsAt) return;
    const expectedActorId = runtime.activeActorId;
    const expectedTurn = runtime.turnNumber;
    this.setTimer(runtime.combatId, Math.max(1, runtime.turnEndsAt - Date.now()), () => {
      void this.withCombatLock(runtime.combatId, async () => {
        const current = this.combats.get(runtime.combatId);
        if (
          !current ||
          current.status !== 'ACTIVE' ||
          current.activeActorId !== expectedActorId ||
          current.turnNumber !== expectedTurn
        )
          return;
        await this.resolveAction(undefined, expectedActorId, current.combatId, {
          action: 'BASIC_ATTACK',
        });
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

  private releaseActors(runtime: CombatRuntime): void {
    const timer = this.timers.get(runtime.combatId);
    if (timer) clearTimeout(timer);
    this.timers.delete(runtime.combatId);
    for (const actor of runtime.actors) {
      if (this.combatByActor.get(actor.actorId) === runtime.combatId)
        this.combatByActor.delete(actor.actorId);
    }
  }

  private requireRuntime(combatId: string): CombatRuntime {
    const runtime = this.combats.get(combatId);
    if (!runtime) this.fail(GAME_ERROR_CODES.COMBAT_NOT_FOUND, 'errors.combat.notFound');
    return runtime;
  }

  private requireParticipant(
    runtime: CombatRuntime,
    characterId: string,
    userId: string,
  ): PlayerSession {
    if (!runtime.actors.some((actor) => actor.characterId === characterId))
      this.fail(GAME_ERROR_CODES.COMBAT_FORBIDDEN, 'errors.combat.forbidden');
    return this.requireOnline(characterId, userId);
  }

  private requireOnline(characterId: string, userId?: string): PlayerSession {
    const session = this.world.getByCharacterId(characterId);
    if (!session?.activeInWorld || (userId && session.userId !== userId))
      this.fail(
        GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
        'errors.combat.participantUnavailable',
      );
    return session;
  }

  private assertAvailable(session: PlayerSession, expectedCombatId?: string): void {
    const combatId = this.combatByActor.get(session.characterId);
    if (session.combatState !== 'IDLE' || (combatId !== undefined && combatId !== expectedCombatId))
      this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
  }

  private assertNearby(first: PlayerSession, second: PlayerSession): void {
    if (first.realmId !== second.realmId || !isCombatDistanceAllowed(first, second))
      this.fail(GAME_ERROR_CODES.COMBAT_TOO_FAR, 'errors.combat.tooFar');
  }

  private withCombatLock<T>(combatId: string, task: () => Promise<T>): Promise<T> {
    return this.executor.run(`combat-session:${combatId}`, task);
  }

  private withActorLocks<T>(
    firstActorId: string,
    secondActorId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const keys = combatActorLockKeys(firstActorId, secondActorId);
    const acquire = (index: number): Promise<T> =>
      index >= keys.length ? task() : this.executor.run(keys[index]!, () => acquire(index + 1));
    return acquire(0);
  }

  private withMovementQuiesced<T>(
    sessions: [PlayerSession, PlayerSession],
    task: () => Promise<T>,
  ): Promise<T> {
    const ordered = [...sessions].sort((a, b) => a.characterId.localeCompare(b.characterId));
    const acquire = (index: number): Promise<T> =>
      index >= ordered.length
        ? task()
        : this.movement.quiesce(ordered[index]!, () => acquire(index + 1));
    return acquire(0);
  }

  private rethrowEngineError(error: unknown): never {
    const code = error instanceof Error ? error.message : '';
    const mapping: Partial<Record<string, [GameErrorCode, string]>> = {
      COMBAT_NOT_ACTIVE: [GAME_ERROR_CODES.COMBAT_NOT_ACTIVE, 'errors.combat.notActive'],
      COMBAT_NOT_YOUR_TURN: [GAME_ERROR_CODES.COMBAT_NOT_YOUR_TURN, 'errors.combat.notYourTurn'],
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
      COMBAT_FORBIDDEN: [GAME_ERROR_CODES.COMBAT_FORBIDDEN, 'errors.combat.forbidden'],
    };
    const match = mapping[code];
    if (match) this.fail(match[0], match[1]);
    throw error;
  }

  private fail(code: GameErrorCode, messageKey: string): never {
    throw new GameError(code, messageKey as never);
  }
}
