import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError, type GameErrorCode } from '../../common/errors/game.error.js';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import type { CombatSnapshot } from '../../contracts/socket.events.js';
import { CombatEngine } from '../combat/combat.engine.js';
import { COMBAT_RESULT_RETENTION_MS } from '../combat/combat.rules.js';
import type { CombatActionCommand, CombatActorInput, CombatRuntime } from '../combat/combat.types.js';
import { MapService } from '../maps/map.service.js';
import { PlayerPersistenceService } from '../persistence/player-persistence.service.js';
import { TradeService } from '../player/trade/trade.service.js';
import { SKILL_CATALOG } from '../skills/skill.catalog.js';
import { SkillService } from '../skills/skill.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { MobCoordinatorService } from './mob-coordinator.service.js';

const MOB_AUTO_ATTACK_DELAY_MS = 900;

@Injectable()
export class PveCombatService implements OnModuleDestroy {
  private readonly logger = new Logger(PveCombatService.name);
  private readonly engine = new CombatEngine();
  private readonly combats = new Map<string, CombatRuntime>();
  private readonly combatByCharacter = new Map<string, string>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private shuttingDown = false;

  constructor(
    private readonly maps: MapService,
    private readonly mobs: MobCoordinatorService,
    private readonly persistence: PlayerPersistenceService,
    private readonly trades: TradeService,
    private readonly skills: SkillService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
    private readonly executor: KeyedSerialExecutor,
  ) {}

  getActive(userId: string, characterId: string): CombatSnapshot | null {
    const session = this.requireOnline(characterId, userId);
    const combatId = this.combatByCharacter.get(session.characterId);
    if (!combatId) return null;
    const runtime = this.combats.get(combatId);
    return runtime ? this.engine.snapshot(runtime) : null;
  }

  hasActive(characterId: string): boolean {
    return this.combatByCharacter.has(characterId);
  }

  async request(userId: string, characterId: string, mobId: string): Promise<CombatSnapshot> {
    return this.executor.run(`pve-character:${characterId}`, async () => {
      const session = this.requireOnline(characterId, userId);
      if (session.combatState !== 'IDLE' || this.combatByCharacter.has(characterId)) {
        this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
      }
      if (await this.trades.hasActive(characterId)) {
        this.fail(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
      }
      const claimed = this.mobs.claim(mobId, session);
      try {
        const player = await this.buildActor(session);
        const map = await this.maps.getMap(session.mapId);
        const now = Date.now();
        const runtime = this.engine.createRequest(
          randomUUID(),
          map.zoneType,
          map.id,
          player,
          claimed.actor,
          now,
          now,
        );
        this.combats.set(runtime.combatId, runtime);
        this.combatByCharacter.set(characterId, runtime.combatId);
        const snapshot = this.engine.start(runtime, now);
        await this.broadcastAndPersist(runtime, snapshot);
        this.scheduleTurn(runtime);
        return snapshot;
      } catch (error) {
        this.mobs.releaseClaim(mobId, characterId);
        throw error;
      }
    });
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
      return snapshot;
    });
  }

  async leave(userId: string, characterId: string, combatId: string): Promise<CombatSnapshot> {
    return this.withCombatLock(combatId, async () => {
      const runtime = this.requireRuntime(combatId);
      this.requirePlayer(runtime, characterId, userId);
      const snapshot = this.engine.forfeit(runtime, characterId, Date.now());
      await this.afterResolution(runtime, snapshot);
      return snapshot;
    });
  }

  async handleDisconnect(characterId: string): Promise<void> {
    const combatId = this.combatByCharacter.get(characterId);
    if (!combatId) return;
    await this.withCombatLock(combatId, async () => {
      const runtime = this.combats.get(combatId);
      if (!runtime || runtime.status !== 'ACTIVE') return;
      const snapshot = this.engine.forfeit(runtime, characterId, Date.now(), 'DISCONNECTED');
      await this.afterResolution(runtime, snapshot);
    });
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const runtime of this.combats.values()) {
      if (runtime.status !== 'ACTIVE') continue;
      const player = runtime.actors.find((actor) => actor.kind === 'PLAYER');
      if (!player) continue;
      const snapshot = this.engine.forfeit(runtime, player.actorId, Date.now(), 'SERVER_SHUTDOWN');
      await this.afterResolution(runtime, snapshot);
    }
    await this.executor.drain();
  }

  private async afterResolution(runtime: CombatRuntime, snapshot: CombatSnapshot): Promise<void> {
    const finished = runtime.status === 'FINISHED';
    if (finished) this.release(runtime);
    await this.broadcastAndPersist(runtime, snapshot);
    if (finished) {
      await this.mobs.completeCombat(runtime);
      this.scheduleCleanup(runtime);
    } else {
      this.scheduleTurn(runtime);
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

  private async broadcastAndPersist(runtime: CombatRuntime, snapshot: CombatSnapshot): Promise<void> {
    const player = runtime.actors.find((actor) => actor.kind === 'PLAYER' && actor.characterId);
    if (!player?.characterId) return;
    const session = this.world.getByCharacterId(player.characterId);
    if (!session) return;
    const combatState = runtime.status === 'ACTIVE' ? 'IN_BATTLE' : 'IDLE';
    session.combatState = combatState;
    session.hp = runtime.status === 'FINISHED' ? Math.max(1, player.hp) : player.hp;
    session.energy = player.energy;
    session.stateRevision += 1;
    session.dirty = true;
    this.publisher.emit(session.socketId, 'combat:updated', snapshot);

    const cooldowns = Object.fromEntries(
      [...player.skills].map(([key, skill]) => [key, skill.cooldownTurnsRemaining]),
    );
    await this.skills.persistCooldowns(session.characterId, cooldowns);
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
  }

  private scheduleTurn(runtime: CombatRuntime): void {
    if (runtime.status !== 'ACTIVE' || !runtime.activeActorId || !runtime.turnEndsAt) return;
    const expectedActorId = runtime.activeActorId;
    const expectedTurn = runtime.turnNumber;
    const active = runtime.actors.find((actor) => actor.actorId === expectedActorId);
    const delay =
      active?.kind === 'MOB'
        ? MOB_AUTO_ATTACK_DELAY_MS
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
        let snapshot: CombatSnapshot;
        try {
          snapshot = this.engine.act(
            current,
            expectedActorId,
            { action: 'BASIC_ATTACK' },
            Date.now(),
          );
        } catch (error) {
          this.rethrowEngineError(error);
        }
        await this.afterResolution(current, snapshot);
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

  private release(runtime: CombatRuntime): void {
    const timer = this.timers.get(runtime.combatId);
    if (timer) clearTimeout(timer);
    this.timers.delete(runtime.combatId);
    const player = runtime.actors.find((actor) => actor.kind === 'PLAYER');
    if (player && this.combatByCharacter.get(player.actorId) === runtime.combatId) {
      this.combatByCharacter.delete(player.actorId);
    }
  }

  private requireRuntime(combatId: string): CombatRuntime {
    const runtime = this.combats.get(combatId);
    if (!runtime) this.fail(GAME_ERROR_CODES.COMBAT_NOT_FOUND, 'errors.combat.notFound');
    return runtime;
  }

  private requirePlayer(runtime: CombatRuntime, characterId: string, userId: string): PlayerSession {
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

  private rethrowEngineError(error: unknown): never {
    const code = error instanceof Error ? error.message : '';
    const mapping: Partial<Record<string, [GameErrorCode, string]>> = {
      COMBAT_NOT_ACTIVE: [GAME_ERROR_CODES.COMBAT_NOT_ACTIVE, 'errors.combat.notActive'],
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
