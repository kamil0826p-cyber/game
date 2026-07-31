import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError, type GameErrorCode } from '../../common/errors/game.error.js';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import type { CombatSnapshot } from '../../contracts/socket.events.js';
import { TelemetryService } from '../../telemetry/telemetry.service.js';
import { CombatOccupancyService } from '../combat/combat-occupancy.service.js';
import { CombatTelegraphService } from '../combat/combat-telegraph.service.js';
import { CombatEngine } from '../combat/combat.engine.js';
import { COMBAT_RESULT_RETENTION_MS, COMBAT_TEAM_LIMIT } from '../combat/combat.rules.js';
import type {
  CombatActionCommand,
  CombatActorInput,
  CombatRuntime,
  CombatRuntimeActor,
} from '../combat/combat.types.js';
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
import { MobAiPlannerService } from './mob-ai-planner.service.js';
import { MobCoordinatorService } from './mob-coordinator.service.js';

const MOB_DECISION_DELAY_MS = 900;

interface PveParty {
  sourceGroupId?: string;
  sessions: PlayerSession[];
}

@Injectable()
export class PveCombatService implements OnModuleDestroy {
  private readonly logger = new Logger(PveCombatService.name);
  private readonly engine = new CombatEngine();
  private readonly combats = new Map<string, CombatRuntime>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly timeoutCounts = new Map<string, number>();
  private readonly finishTelemetrySent = new Set<string>();
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
    private readonly telegraphs: CombatTelegraphService,
    private readonly aiPlanner: MobAiPlannerService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
    private readonly executor: KeyedSerialExecutor,
    private readonly telemetry: TelemetryService,
  ) {}

  getActive(userId: string, characterId: string): CombatSnapshot | null {
    const session = this.requireOnline(characterId, userId);
    const combatId = this.occupancy.getCombatId(session.characterId);
    if (!combatId) return null;
    const runtime = this.combats.get(combatId);
    return runtime ? this.telegraphs.decorate(this.engine.snapshot(runtime)) : null;
  }

  hasActive(characterId: string): boolean {
    const combatId = this.occupancy.getCombatId(characterId);
    return Boolean(combatId && this.combats.has(combatId));
  }

  async request(userId: string, characterId: string, mobId: string): Promise<CombatSnapshot> {
    const initiator = this.requireOnline(characterId, userId);
    const initialParty = await this.resolveAvailableParty(initiator);
    return this.withPartyLocks(
      initialParty.sessions.map((session) => session.characterId),
      () =>
        this.withMovementQuiesced(initialParty.sessions, async () => {
          const activeInitiator = this.requireOnline(characterId, userId);
          const party = await this.revalidateFrozenParty(activeInitiator, initialParty);
          const claimed = this.mobs.claim(mobId, activeInitiator);
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
                anchorActorId: claimed.actor.actorId,
                actors: [claimed.actor],
              },
              now,
              now,
            );
            this.combats.set(runtime.combatId, runtime);
            this.timeoutCounts.set(runtime.combatId, 0);
            const snapshot = this.engine.start(runtime, now);
            this.telemetry.emit(
              'combat_started',
              {
                userId: activeInitiator.userId,
                characterId: activeInitiator.characterId,
                realmId: activeInitiator.realmId,
              },
              {
                combatId: runtime.combatId,
                mode: 'PVE',
                participantCount: runtime.actors.length,
              },
            );
            await this.broadcastAndPersist(runtime, snapshot);
            this.scheduleTurn(runtime);
            return this.telegraphs.decorate(snapshot);
          } catch (error) {
            if (runtime) {
              this.combats.delete(runtime.combatId);
              this.timeoutCounts.delete(runtime.combatId);
              this.telegraphs.clear(runtime.combatId);
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
            if (error instanceof Error && error.message === 'COMBAT_OCCUPANCY_CONFLICT') {
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
      let snapshot: CombatSnapshot;
      try {
        snapshot = this.engine.act(runtime, characterId, command, Date.now());
      } catch (error) {
        this.rethrowEngineError(error);
      }
      await this.afterResolution(runtime, snapshot);
      return this.telegraphs.decorate(snapshot);
    });
  }

  async leave(userId: string, characterId: string, combatId: string): Promise<CombatSnapshot> {
    return this.withCombatLock(combatId, async () => {
      const runtime = this.requireRuntime(combatId);
      this.requirePlayer(runtime, characterId, userId);
      const snapshot = this.engine.forfeit(runtime, characterId, Date.now());
      this.occupancy.release(characterId, runtime.combatId);
      this.telegraphs.removeActor(runtime.combatId, characterId);
      await this.afterResolution(runtime, snapshot);
      return this.telegraphs.decorate(snapshot);
    });
  }

  async handleDisconnect(characterId: string): Promise<void> {
    const combatId = this.occupancy.getCombatId(characterId);
    if (!combatId || !this.combats.has(combatId)) return;
    await this.withCombatLock(combatId, async () => {
      const runtime = this.combats.get(combatId);
      if (!runtime || runtime.status !== 'ACTIVE') return;
      const snapshot = this.engine.forfeit(
        runtime,
        characterId,
        Date.now(),
        'DISCONNECTED',
      );
      this.occupancy.release(characterId, runtime.combatId);
      this.telegraphs.removeActor(runtime.combatId, characterId);
      await this.afterResolution(runtime, snapshot);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const runtime of this.combats.values()) {
      if (runtime.status !== 'ACTIVE') continue;
      const snapshot = this.engine.terminate(runtime, 'SERVER_SHUTDOWN', Date.now());
      this.release(runtime);
      await this.broadcastAndPersist(runtime, snapshot);
    }
    await this.executor.drain();
  }

  private async afterResolution(runtime: CombatRuntime, snapshot: CombatSnapshot): Promise<void> {
    const finished = runtime.status === 'FINISHED';
    if (finished) {
      this.emitFinishedTelemetry(runtime);
      this.release(runtime);
    }
    await this.broadcastAndPersist(runtime, snapshot);
    if (finished) {
      await this.mobs.completeCombat(runtime);
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

  private async broadcastAndPersist(
    runtime: CombatRuntime,
    snapshot: CombatSnapshot,
  ): Promise<void> {
    const decorated = this.telegraphs.decorate(snapshot);
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
      this.publisher.emit(session.socketId, 'combat:updated', decorated);
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
    if (runtime.status !== 'ACTIVE' || !runtime.activeActorId || !runtime.turnEndsAt) return;
    const expectedActorId = runtime.activeActorId;
    const expectedTurn = runtime.turnNumber;
    const active = runtime.actors.find((actor) => actor.actorId === expectedActorId);
    const delay =
      active?.kind === 'MOB'
        ? MOB_DECISION_DELAY_MS
        : Math.max(1, runtime.turnEndsAt - Date.now());
    this.setTimer(runtime.combatId, delay, () => {
      void this.withCombatLock(runtime.combatId, async () => {
        const current = this.combats.get(runtime.combatId);
        if (
          !current ||
          current.status !== 'ACTIVE' ||
          current.activeActorId !== expectedActorId ||
          current.turnNumber !== expectedTurn
        ) {
          return;
        }
        const acting = current.actors.find((actor) => actor.actorId === expectedActorId);
        if (!acting) return;

        let command: CombatActionCommand;
        if (acting.kind === 'MOB') {
          command = this.resolveMobCommand(current, acting);
        } else {
          command = this.fallbackAttack(current, acting);
          const count = (this.timeoutCounts.get(current.combatId) ?? 0) + 1;
          this.timeoutCounts.set(current.combatId, count);
          const session = acting.characterId
            ? this.world.getByCharacterId(acting.characterId)
            : undefined;
          this.telemetry.emit(
            'turn_timed_out',
            {
              userId: session?.userId,
              characterId: session?.characterId,
              realmId: session?.realmId,
            },
            { combatId: current.combatId, turnNumber: current.turnNumber },
          );
        }

        let snapshot: CombatSnapshot;
        try {
          snapshot = this.engine.act(current, expectedActorId, command, Date.now());
        } catch (error) {
          this.rethrowEngineError(error);
        }
        await this.afterResolution(current, snapshot);
      });
    });
  }

  private resolveMobCommand(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
  ): CombatActionCommand {
    const prepared = this.telegraphs.resolveReady(
      runtime.combatId,
      actor.actorId,
      runtime.turnNumber,
    );
    if (prepared && this.isCommandTargetLegal(runtime, actor, prepared)) return prepared;

    const allies = runtime.actors.filter(
      (candidate) =>
        candidate.teamId === actor.teamId && !candidate.withdrawn && candidate.hp > 0,
    );
    const enemies = runtime.actors.filter(
      (candidate) =>
        candidate.teamId !== actor.teamId && !candidate.withdrawn && candidate.hp > 0,
    );
    const plan = this.aiPlanner.plan(this.mobs.getAiProfile(actor.actorId), {
      actor,
      allies,
      enemies,
      turnNumber: runtime.turnNumber,
    });
    if (!plan.telegraph) return plan.command;

    this.telegraphs.prepare(
      runtime.combatId,
      actor.actorId,
      plan.command.targetActorId,
      plan.command,
      runtime.turnNumber,
      plan.telegraph,
    );
    return this.fallbackAttack(runtime, actor);
  }

  private isCommandTargetLegal(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
    command: CombatActionCommand,
  ): boolean {
    if (!command.targetActorId) return true;
    const target = runtime.actors.find(
      (candidate) => candidate.actorId === command.targetActorId,
    );
    if (!target || target.withdrawn || target.hp <= 0) return false;
    if (command.action === 'SKILL' && command.skillKey) {
      const skill = actor.skills.get(command.skillKey);
      if (!skill) return false;
      return skill.definition.targeting === 'SELF'
        ? target.actorId === actor.actorId
        : target.teamId !== actor.teamId;
    }
    return target.teamId !== actor.teamId;
  }

  private fallbackAttack(
    runtime: CombatRuntime,
    actor: CombatRuntimeActor,
  ): CombatActionCommand {
    const target = runtime.actors
      .filter(
        (candidate) =>
          candidate.teamId !== actor.teamId && !candidate.withdrawn && candidate.hp > 0,
      )
      .sort(
        (left, right) =>
          left.hp / Math.max(1, left.maxHp) - right.hp / Math.max(1, right.maxHp) ||
          left.actorId.localeCompare(right.actorId),
      )[0];
    return {
      action: 'BASIC_ATTACK',
      ...(target ? { targetActorId: target.actorId } : {}),
    };
  }

  private emitFinishedTelemetry(runtime: CombatRuntime): void {
    if (this.finishTelemetrySent.has(runtime.combatId)) return;
    this.finishTelemetrySent.add(runtime.combatId);
    const player = runtime.actors.find(
      (actor) => actor.kind === 'PLAYER' && actor.characterId,
    );
    const session = player?.characterId
      ? this.world.getByCharacterId(player.characterId)
      : undefined;
    this.telemetry.emit(
      'combat_finished',
      {
        userId: session?.userId,
        characterId: session?.characterId,
        realmId: session?.realmId,
      },
      {
        combatId: runtime.combatId,
        mode: 'PVE',
        durationMs: Math.max(0, (runtime.finishedAt ?? Date.now()) - (runtime.startedAt ?? runtime.createdAt)),
        turnCount: Math.max(0, runtime.turnNumber),
        timeoutCount: this.timeoutCounts.get(runtime.combatId) ?? 0,
        finishReason: runtime.finishReason ?? 'UNKNOWN',
      },
    );
  }

  private scheduleCleanup(runtime: CombatRuntime): void {
    this.setTimer(runtime.combatId, COMBAT_RESULT_RETENTION_MS, () => {
      this.combats.delete(runtime.combatId);
      this.timers.delete(runtime.combatId);
      this.timeoutCounts.delete(runtime.combatId);
      this.finishTelemetrySent.delete(runtime.combatId);
      this.telegraphs.clear(runtime.combatId);
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
      index >= keys.length ? task() : this.executor.run(keys[index]!, () => acquire(index + 1));
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
