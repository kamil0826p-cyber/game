import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import {
  GAME_ERROR_CODES,
  GameError,
  type GameErrorCode,
} from '../../common/errors/game.error.js';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import type { CombatSnapshot } from '../../contracts/socket.events.js';
import { CombatOccupancyService } from '../combat/combat-occupancy.service.js';
import { CombatEngine } from '../combat/combat.engine.js';
import {
  COMBAT_RESULT_RETENTION_MS,
  COMBAT_TEAM_LIMIT,
} from '../combat/combat.rules.js';
import type {
  CombatActionCommand,
  CombatActorInput,
  CombatRuntime,
} from '../combat/combat.types.js';
import { GroupService } from '../groups/group.service.js';
import { MapService } from '../maps/map.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import { PlayerPersistenceService } from '../persistence/player-persistence.service.js';
import { TradeService } from '../player/trade/trade.service.js';
import { SkillService } from '../skills/skill.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { planEncounterAction } from './encounters/encounter.ai.js';
import './encounters/encounter.contracts.js';
import {
  appendEncounterAiTrace,
  createEncounterExecution,
  decorateEncounterSnapshot,
  recordEncounterTimeout,
  synchronizeEncounter,
} from './encounters/encounter.runtime.js';
import type { EncounterExecution } from './encounters/encounter.types.js';
import { MobCoordinatorService } from './mob-coordinator.service.js';

const MOB_AUTO_ATTACK_DELAY_MS = 900;

interface PveParty {
  sourceGroupId?: string;
  sessions: PlayerSession[];
}

@Injectable()
export class PveCombatService implements OnModuleDestroy {
  private readonly logger = new Logger(PveCombatService.name);
  private readonly engine = new CombatEngine();
  private readonly combats = new Map<string, CombatRuntime>();
  private readonly encounters = new Map<string, EncounterExecution>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly completedRewards = new Set<string>();
  private shuttingDown = false;

  constructor(
    private readonly maps: MapService,
    private readonly mobs: MobCoordinatorService,
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
      this.engine.reconnect(runtime, characterId, Date.now());
      const snapshot = this.syncEncounter(runtime);
      this.scheduleTurn(runtime);
      return snapshot;
    });
  }

  hasActive(characterId: string): boolean {
    const combatId = this.occupancy.getCombatId(characterId);
    return Boolean(combatId && this.combats.has(combatId));
  }

  async request(
    userId: string,
    characterId: string,
    mobId: string,
  ): Promise<CombatSnapshot> {
    const initiator = this.requireOnline(characterId, userId);
    const initialParty = await this.resolveAvailableParty(initiator);
    return this.withPartyLocks(
      initialParty.sessions.map((session) => session.characterId),
      () =>
        this.withMovementQuiesced(initialParty.sessions, async () => {
          const activeInitiator = this.requireOnline(characterId, userId);
          const party = await this.revalidateFrozenParty(activeInitiator, initialParty);
          const claimed = this.mobs.claim(mobId, activeInitiator, party.sessions.length);
          let runtime: CombatRuntime | undefined;
          const combatId = randomUUID();
          for (const session of party.sessions) {
            session.combatState = 'IN_BATTLE';
            session.stateRevision += 1;
            session.dirty = true;
          }
          try {
            this.occupancy.reserve(
              party.sessions.map((session) => session.characterId),
              combatId,
            );
            const players = await Promise.all(
              party.sessions.map((session) => this.buildActor(session)),
            );
            await this.assertNoTrades(party.sessions);
            const map = await this.maps.getMap(activeInitiator.mapId);
            const now = Date.now();
            runtime = this.engine.createRequest(
              combatId,
              map.zoneType,
              map.id,
              {
                anchorActorId: activeInitiator.characterId,
                sourceGroupId: party.sourceGroupId,
                actors: players,
              },
              {
                anchorActorId: claimed.encounter.rootActorId,
                actors: claimed.encounter.initialActors,
              },
              now,
              now,
            );
            this.combats.set(runtime.combatId, runtime);
            this.encounters.set(
              runtime.combatId,
              createEncounterExecution(
                runtime,
                mobId,
                claimed.encounter,
                this.encounterSeed(runtime.combatId),
              ),
            );
            this.engine.start(runtime, now);
            const snapshot = this.syncEncounter(runtime, now);
            await this.broadcastAndPersist(runtime, snapshot);
            this.scheduleTurn(runtime);
            return snapshot;
          } catch (error) {
            if (runtime) {
              this.combats.delete(runtime.combatId);
              this.encounters.delete(runtime.combatId);
            }
            this.occupancy.releaseMany(
              party.sessions.map((session) => session.characterId),
              combatId,
            );
            for (const session of party.sessions) {
              session.combatState = 'IDLE';
              session.stateRevision += 1;
              session.dirty = true;
            }
            this.mobs.releaseClaim(mobId, characterId);
            if (
              error instanceof Error &&
              error.message === 'COMBAT_OCCUPANCY_CONFLICT'
            ) {
              this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
            }
            throw error;
          }
        }),
    );
  }

  async act(
    userId: string,
    characterId: string,
    combatId: string,
    command: CombatActionCommand,
  ): Promise<CombatSnapshot> {
    return this.withCombatLock(combatId, async () => {
      const runtime = this.requireRuntime(combatId);
      this.requirePlayer(runtime, characterId, userId);
      try {
        this.engine.act(runtime, characterId, command, Date.now());
      } catch (error) {
        this.rethrowEngineError(error);
      }
      const snapshot = this.syncEncounter(runtime);
      await this.afterResolution(runtime, snapshot);
      return snapshot;
    });
  }

  async leave(
    userId: string,
    characterId: string,
    combatId: string,
  ): Promise<CombatSnapshot> {
    return this.withCombatLock(combatId, async () => {
      const runtime = this.requireRuntime(combatId);
      this.requirePlayer(runtime, characterId, userId);
      this.engine.forfeit(runtime, characterId, Date.now());
      this.occupancy.release(characterId, runtime.combatId);
      const snapshot = this.syncEncounter(runtime);
      await this.afterResolution(runtime, snapshot);
      return snapshot;
    });
  }

  async handleDisconnect(characterId: string): Promise<void> {
    const combatId = this.occupancy.getCombatId(characterId);
    if (!combatId || !this.combats.has(combatId)) return;
    await this.withCombatLock(combatId, async () => {
      const runtime = this.combats.get(combatId);
      if (!runtime || runtime.status !== 'ACTIVE') return;
      this.engine.disconnect(runtime, characterId, Date.now());
      const snapshot = this.syncEncounter(runtime);
      await this.broadcastAndPersist(runtime, snapshot);
      this.scheduleTurn(runtime);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const runtime of this.combats.values()) {
      if (runtime.status !== 'ACTIVE') continue;
      this.engine.terminate(runtime, 'SERVER_SHUTDOWN', Date.now());
      const execution = this.encounters.get(runtime.combatId);
      if (execution) {
        this.mobs.releaseClaim(execution.state.rootMobId, runtime.initiatorActorId);
      }
      this.release(runtime);
      const snapshot = execution
        ? decorateEncounterSnapshot(this.engine.snapshot(runtime), runtime, execution.state)
        : this.engine.snapshot(runtime);
      await this.broadcastAndPersist(runtime, snapshot);
    }
    await this.executor.drain();
  }

  private async afterResolution(
    runtime: CombatRuntime,
    snapshot: CombatSnapshot,
  ): Promise<void> {
    const finished = runtime.status === 'FINISHED';
    if (finished) this.release(runtime);
    await this.broadcastAndPersist(runtime, snapshot);
    if (finished) {
      if (!this.completedRewards.has(runtime.combatId)) {
        this.completedRewards.add(runtime.combatId);
        try {
          await this.mobs.completeCombat(runtime, this.requireEncounter(runtime.combatId).state);
        } catch (error) {
          this.completedRewards.delete(runtime.combatId);
          throw error;
        }
      }
      this.scheduleCleanup(runtime);
    } else {
      this.scheduleTurn(runtime);
    }
  }

  private async resolveAvailableParty(anchor: PlayerSession): Promise<PveParty> {
    const group = this.groups.getSnapshot(anchor).group;
    const sourceGroupId = group?.id;
    const memberIds =
      group?.members.map((member) => member.characterId) ?? [anchor.characterId];
    const sessions = memberIds
      .slice(0, COMBAT_TEAM_LIMIT)
      .map((memberId) => this.world.getByCharacterId(memberId))
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
    party: PveParty,
  ): Promise<PveParty> {
    const group = this.groups.getSnapshot(anchor).group;
    if ((group?.id ?? undefined) !== party.sourceGroupId) {
      this.fail(
        GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
        'errors.combat.participantUnavailable',
      );
    }
    const currentIds = new Set(
      group?.members.map((member) => member.characterId) ?? [anchor.characterId],
    );
    const sessions = party.sessions.map((original) => {
      if (!currentIds.has(original.characterId)) {
        this.fail(
          GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
          'errors.combat.participantUnavailable',
        );
      }
      const session = this.requireOnline(original.characterId);
      if (
        session.realmId !== anchor.realmId ||
        session.mapId !== anchor.mapId ||
        session.combatState !== 'IDLE' ||
        this.occupancy.isOccupied(session.characterId)
      ) {
        this.fail(
          GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
          'errors.combat.participantUnavailable',
        );
      }
      return session;
    });
    await this.assertNoTrades(sessions);
    return { sourceGroupId: party.sourceGroupId, sessions };
  }

  private async assertNoTrades(sessions: readonly PlayerSession[]): Promise<void> {
    const active = await Promise.all(
      sessions.map((session) => this.trades.hasActive(session.characterId)),
    );
    if (active.some(Boolean)) {
      this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
    }
  }

  private async buildActor(session: PlayerSession): Promise<CombatActorInput> {
    const loadout = await this.skills.getCombatLoadout(
      session.userId,
      session.characterId,
    );
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
      skills: loadout.definitions,
      fallbackAction: loadout.fallbackAction,
    };
  }

  private async broadcastAndPersist(
    runtime: CombatRuntime,
    snapshot: CombatSnapshot,
  ): Promise<void> {
    const sessions: PlayerSession[] = [];
    for (const player of runtime.actors.filter(
      (actor) => actor.kind === 'PLAYER' && actor.characterId,
    )) {
      const session = this.world.getByCharacterId(player.characterId!);
      if (!session) continue;
      const stillFighting = runtime.status === 'ACTIVE' && !player.withdrawn;
      session.combatState = stillFighting ? 'IN_BATTLE' : 'IDLE';
      session.hp = stillFighting ? player.hp : Math.max(1, player.hp);
      session.energy = player.energy;
      session.stateRevision += 1;
      session.dirty = true;
      sessions.push(session);
      this.publisher.emit(session.socketId, 'combat:updated', snapshot);
      const cooldowns = Object.fromEntries(
        [...player.skills].map(([key, skill]) => [key, skill.cooldownTurnsRemaining]),
      );
      await this.skills
        .persistCooldowns(session.characterId, cooldowns)
        .catch((error: unknown) => {
          this.logger.error(
            `Could not persist PVE cooldowns for ${session.characterId}.`,
            error instanceof Error ? error.stack : undefined,
          );
        });
    }
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
            `Could not checkpoint PVE combat for ${session.characterId}.`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }),
    );
  }

  private scheduleTurn(runtime: CombatRuntime): void {
    if (runtime.status !== 'ACTIVE' || !runtime.activeActorId || !runtime.turnEndsAt) {
      return;
    }
    const expectedActorId = runtime.activeActorId;
    const expectedTurn = runtime.turnNumber;
    const expectedPhase = runtime.phase;
    const active = runtime.actors.find((actor) => actor.actorId === expectedActorId);
    const reactingMob =
      runtime.phase === 'REACTION'
        ? runtime.actors.find(
            (actor) =>
              actor.kind === 'MOB' &&
              this.engine
                .legalActions(runtime, actor.actorId)
                .some((action) => action.reactionOnly),
          )
        : undefined;
    const delay =
      runtime.phase === 'REACTION'
        ? reactingMob
          ? MOB_AUTO_ATTACK_DELAY_MS
          : Math.max(1, runtime.turnEndsAt - Date.now())
        : active?.kind === 'MOB'
          ? MOB_AUTO_ATTACK_DELAY_MS
          : Math.max(1, runtime.turnEndsAt - Date.now());
    this.setTimer(runtime.combatId, delay, () => {
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
        const execution = this.requireEncounter(current.combatId);
        try {
          if (current.phase === 'REACTION') {
            const reactor = current.actors.find(
              (actor) =>
                actor.kind === 'MOB' &&
                this.engine
                  .legalActions(current, actor.actorId)
                  .some((action) => action.reactionOnly),
            );
            if (reactor) {
              const legalActions = this.engine.legalActions(current, reactor.actorId);
              const plan = planEncounterAction(current, reactor, execution.state, legalActions);
              if (plan) {
                appendEncounterAiTrace(
                  execution.state,
                  `${current.turnNumber}:${reactor.actorId}:${plan.reason}`,
                );
                this.engine.act(current, reactor.actorId, plan.command, now);
              } else {
                this.engine.resolveTelegraph(current, now);
              }
            } else {
              this.engine.resolveTelegraph(current, now);
            }
          } else {
            const acting = current.actors.find(
              (actor) => actor.actorId === expectedActorId,
            );
            if (!acting) return;
            if (
              acting.kind === 'PLAYER' &&
              this.engine.isDisconnectGraceExpired(current, expectedActorId, now)
            ) {
              this.engine.forfeit(
                current,
                expectedActorId,
                now,
                'DISCONNECTED',
              );
              this.occupancy.release(expectedActorId, current.combatId);
            } else if (acting.kind === 'MOB') {
              const legalActions = this.engine.legalActions(current, expectedActorId);
              const plan = planEncounterAction(current, acting, execution.state, legalActions);
              if (plan) {
                appendEncounterAiTrace(
                  execution.state,
                  `${current.turnNumber}:${acting.actorId}:${plan.reason}`,
                );
                this.engine.act(current, expectedActorId, plan.command, now);
              } else {
                this.engine.timeout(current, expectedActorId, now);
              }
            } else {
              recordEncounterTimeout(execution.state, expectedActorId, current.turnNumber);
              this.engine.timeout(current, expectedActorId, now);
            }
          }
        } catch (error) {
          this.rethrowEngineError(error);
        }
        const snapshot = this.syncEncounter(current, now);
        await this.afterResolution(current, snapshot);
      });
    });
  }

  private scheduleCleanup(runtime: CombatRuntime): void {
    this.setTimer(runtime.combatId, COMBAT_RESULT_RETENTION_MS, () => {
      this.combats.delete(runtime.combatId);
      this.encounters.delete(runtime.combatId);
      this.timers.delete(runtime.combatId);
      this.completedRewards.delete(runtime.combatId);
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

  private release(runtime: CombatRuntime): void {
    const timer = this.timers.get(runtime.combatId);
    if (timer) clearTimeout(timer);
    this.timers.delete(runtime.combatId);
    this.occupancy.releaseMany(
      runtime.actors
        .filter((actor) => actor.kind === 'PLAYER')
        .map((actor) => actor.actorId),
      runtime.combatId,
    );
  }

  private syncEncounter(runtime: CombatRuntime, now = Date.now()): CombatSnapshot {
    return synchronizeEncounter(
      this.engine,
      runtime,
      this.requireEncounter(runtime.combatId),
      now,
    );
  }

  private requireEncounter(combatId: string): EncounterExecution {
    const encounter = this.encounters.get(combatId);
    if (!encounter) throw new Error('ENCOUNTER_RUNTIME_NOT_FOUND');
    return encounter;
  }

  private encounterSeed(combatId: string): number {
    return Number.parseInt(combatId.replaceAll('-', '').slice(0, 8), 16) || 1;
  }

  private requireRuntime(combatId: string): CombatRuntime {
    const runtime = this.combats.get(combatId);
    if (!runtime) {
      this.fail(GAME_ERROR_CODES.COMBAT_NOT_FOUND, 'errors.combat.notFound');
    }
    return runtime;
  }

  private requirePlayer(
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

  private withCombatLock<T>(combatId: string, task: () => Promise<T>): Promise<T> {
    return this.executor.run(`pve-combat:${combatId}`, task);
  }

  private withPartyLocks<T>(
    characterIds: Iterable<string>,
    task: () => Promise<T>,
  ): Promise<T> {
    const keys = [...new Set(characterIds)]
      .sort()
      .map((characterId) => `pve-character:${characterId}`);
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
    const ordered = [...sessions].sort((left, right) =>
      left.characterId.localeCompare(right.characterId),
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
