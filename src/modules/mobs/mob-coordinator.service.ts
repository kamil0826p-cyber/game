import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { isActorWithinInteractionRange } from '../../common/rules/actor-interaction.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { MobRewardPayload, MobStatePayload } from '../../contracts/mob.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CombatRuntime } from '../combat/combat.types.js';
import { MapService } from '../maps/map.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { MOB_RANKS, type MobLootEntry, type MobRank } from './mob.catalog.js';
import { MobRewardService } from './mob-reward.service.js';
import type { ClaimedMob, RuntimeMob } from './mob.types.js';

const RESPAWN_OCCUPIED_RETRY_MS = 1_000;
const MIN_RENDER_SCALE = 0.2;
const MAX_RENDER_SCALE = 3;

@Injectable()
export class MobCoordinatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MobCoordinatorService.name);
  private readonly mobs = new Map<string, RuntimeMob>();
  private readonly mobIdByActorId = new Map<string, string>();
  private readonly respawnTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly maps: MapService,
    private readonly rewards: MobRewardService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  async onModuleInit(): Promise<void> {
    const records = await this.prisma.mobDefinition.findMany({
      orderBy: [{ mapId: 'asc' }, { key: 'asc' }],
    });
    for (const record of records) {
      const mob = this.toRuntimeMob(record);
      const map = await this.maps.getMap(mob.mapId);
      if (!this.maps.isInside(map, mob.x, mob.y) || this.maps.isCollision(map, mob.x, mob.y)) {
        throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
          reason: `Mob ${record.key} is placed on an invalid tile.`,
        });
      }
      if (
        [...this.mobs.values()].some(
          (candidate) =>
            candidate.mapId === mob.mapId && candidate.x === mob.x && candidate.y === mob.y,
        )
      ) {
        throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
          reason: `Multiple mobs occupy ${mob.mapId}:${mob.x},${mob.y}.`,
        });
      }
      this.mobs.set(mob.id, mob);
      this.mobIdByActorId.set(this.actorId(mob.id), mob.id);
      map.collision[mob.y * map.width + mob.x] = 1;
    }
    this.logger.log(`Loaded ${this.mobs.size} mob instances from the database.`);
  }

  onModuleDestroy(): void {
    this.shuttingDown = true;
    for (const timer of this.respawnTimers.values()) clearTimeout(timer);
    this.respawnTimers.clear();
  }

  getMapMobs(mapId: string): MobStatePayload[] {
    return [...this.mobs.values()]
      .filter((mob) => mob.mapId === mapId && mob.state !== 'RESPAWNING')
      .map((mob) => this.toPayload(mob));
  }

  isTileOccupied(mapId: string, x: number, y: number): boolean {
    return [...this.mobs.values()].some(
      (mob) =>
        mob.mapId === mapId &&
        mob.x === x &&
        mob.y === y &&
        mob.state !== 'RESPAWNING',
    );
  }

  claim(mobId: string, session: PlayerSession): ClaimedMob {
    const mob = this.requireMob(mobId);
    if (mob.state !== 'ALIVE') {
      throw new GameError(GAME_ERROR_CODES.COMBAT_BUSY, 'errors.combat.busy');
    }
    if (!isActorWithinInteractionRange(session, mob)) {
      throw new GameError(GAME_ERROR_CODES.COMBAT_TOO_FAR, 'errors.combat.tooFar');
    }
    mob.state = 'IN_COMBAT';
    mob.engagedCharacterId = session.characterId;
    mob.respawnsAt = undefined;
    return {
      mob,
      actor: {
        actorId: this.actorId(mob.id),
        kind: 'MOB',
        name: mob.name,
        characterClass: mob.characterClass,
        level: mob.level,
        outfitKey: mob.outfitKey,
        renderScale: mob.renderScale,
        hp: mob.stats.maxHp,
        maxHp: mob.stats.maxHp,
        energy: mob.stats.maxEnergy,
        maxEnergy: mob.stats.maxEnergy,
        strength: mob.stats.strength,
        agility: mob.stats.agility,
        intelligence: mob.stats.intelligence,
        armor: mob.stats.armor,
        skills: [],
      },
    };
  }

  releaseClaim(mobId: string, characterId: string): void {
    const mob = this.mobs.get(mobId);
    if (!mob || mob.engagedCharacterId !== characterId || mob.state !== 'IN_COMBAT') return;
    mob.state = 'ALIVE';
    mob.engagedCharacterId = undefined;
  }

  async completeCombat(runtime: CombatRuntime): Promise<void> {
    const mobActor = runtime.actors.find((actor) => actor.kind === 'MOB');
    const playerActor = runtime.actors.find((actor) => actor.kind === 'PLAYER');
    if (!mobActor || !playerActor?.characterId) return;
    const mobId = this.mobIdByActorId.get(mobActor.actorId);
    if (!mobId) return;
    const mob = this.mobs.get(mobId);
    if (!mob || mob.engagedCharacterId !== playerActor.characterId) return;

    const playerWon =
      runtime.finishReason === 'DEFEATED' && runtime.winnerActorId === playerActor.actorId;
    if (!playerWon) {
      this.releaseClaim(mob.id, playerActor.characterId);
      return;
    }

    mob.state = 'RESPAWNING';
    mob.engagedCharacterId = undefined;
    const map = await this.maps.getMap(mob.mapId);
    map.collision[mob.y * map.width + mob.x] = 0;
    mob.respawnsAt = Date.now() + mob.respawnMs;
    this.broadcastDespawn(mob.mapId, { mobId: mob.id, respawnsAt: mob.respawnsAt });
    this.scheduleRespawn(mob);

    const session = this.world.getByCharacterId(playerActor.characterId);
    if (!session) return;
    try {
      const settlement = await this.rewards.award(session, mob);
      const payload: MobRewardPayload = {
        mobId: mob.id,
        mobName: mob.name,
        experienceGained: settlement.experienceGained,
        levelsGained: settlement.levelsGained,
        nextLevelExperience: settlement.nextLevelExperience,
        loot: settlement.loot,
        skippedLoot: settlement.skippedLoot,
        self: this.world.toSelfState(session),
      };
      this.publisher.emit(session.socketId, 'mob:rewards', payload);
      this.publisher.emit(session.socketId, 'notification', {
        code: 'MOB_REWARD',
        message:
          session.locale === 'pl'
            ? `Pokonano ${mob.name}: +${settlement.experienceGained} doświadczenia.`
            : `Defeated ${mob.name}: +${settlement.experienceGained} experience.`,
      });
      if (settlement.levelsGained > 0) {
        this.publisher.emit(session.socketId, 'notification', {
          code: 'LEVEL_UP',
          message:
            session.locale === 'pl'
              ? `Awans! Twoja postać osiągnęła ${session.level} poziom.`
              : `Level up! Your character reached level ${session.level}.`,
        });
      }
      if (settlement.skippedLoot.length > 0) {
        this.publisher.emit(session.socketId, 'notification', {
          code: 'MOB_LOOT_SKIPPED',
          message:
            session.locale === 'pl'
              ? 'Część łupu przepadła, ponieważ ekwipunek jest pełny.'
              : 'Some loot was left behind because the inventory is full.',
        });
      }
    } catch (error) {
      this.logger.error(
        `Could not settle rewards for ${session.characterId} after defeating ${mob.id}.`,
        error instanceof Error ? error.stack : undefined,
      );
      this.publisher.emit(session.socketId, 'notification', {
        code: GAME_ERROR_CODES.INTERNAL_ERROR,
        message:
          session.locale === 'pl'
            ? 'Wystąpił wewnętrzny błąd serwera.'
            : 'An internal server error occurred.',
      });
    }
  }

  private scheduleRespawn(mob: RuntimeMob): void {
    const previous = this.respawnTimers.get(mob.id);
    if (previous) clearTimeout(previous);
    if (this.shuttingDown) return;
    const delay = Math.max(1, (mob.respawnsAt ?? Date.now()) - Date.now());
    const timer = setTimeout(() => void this.tryRespawn(mob.id), delay);
    timer.unref?.();
    this.respawnTimers.set(mob.id, timer);
  }

  private async tryRespawn(mobId: string): Promise<void> {
    const mob = this.mobs.get(mobId);
    if (!mob || mob.state !== 'RESPAWNING' || this.shuttingDown) return;
    if (this.world.isOccupied(mob.mapId, mob.x, mob.y)) {
      mob.respawnsAt = Date.now() + RESPAWN_OCCUPIED_RETRY_MS;
      this.scheduleRespawn(mob);
      return;
    }
    const map = await this.maps.getMap(mob.mapId);
    map.collision[mob.y * map.width + mob.x] = 1;
    mob.state = 'ALIVE';
    mob.respawnsAt = undefined;
    this.respawnTimers.delete(mob.id);
    this.broadcastSpawn(mob.mapId, this.toPayload(mob));
  }

  private broadcastSpawn(mapId: string, payload: MobStatePayload): void {
    for (const session of this.world.listSessions()) {
      if (session.activeInWorld && session.mapId === mapId) {
        this.publisher.emit(session.socketId, 'world:mobSpawned', payload);
      }
    }
  }

  private broadcastDespawn(
    mapId: string,
    payload: { mobId: string; respawnsAt: number },
  ): void {
    for (const session of this.world.listSessions()) {
      if (session.activeInWorld && session.mapId === mapId) {
        this.publisher.emit(session.socketId, 'world:mobDespawned', payload);
      }
    }
  }

  private requireMob(mobId: string): RuntimeMob {
    const mob = this.mobs.get(mobId);
    if (!mob) {
      throw new GameError(
        GAME_ERROR_CODES.COMBAT_PARTICIPANT_UNAVAILABLE,
        'errors.combat.participantUnavailable',
      );
    }
    return mob;
  }

  private actorId(mobId: string): string {
    return `mob:${mobId}`;
  }

  private toPayload(mob: RuntimeMob): MobStatePayload {
    return {
      id: mob.id,
      definitionKey: mob.definitionKey,
      name: mob.name,
      rank: mob.rank,
      mapId: mob.mapId,
      x: mob.x,
      y: mob.y,
      level: mob.level,
      outfitKey: mob.outfitKey,
      renderScale: mob.renderScale,
    };
  }

  private toRuntimeMob(record: {
    id: string;
    key: string;
    name: string;
    mapId: string;
    x: number;
    y: number;
    level: number;
    outfitKey: string;
    stats: unknown;
    lootTable: unknown;
    respawnMs: number;
  }): RuntimeMob {
    const stats = record.stats as Partial<RuntimeMob['stats']> & {
      rank?: unknown;
      experience?: unknown;
      characterClass?: unknown;
      renderScale?: unknown;
    };
    const rank = stats.rank;
    const characterClass = stats.characterClass;
    const renderScale = stats.renderScale;
    const loot = Array.isArray(record.lootTable) ? record.lootTable : [];
    if (
      typeof rank !== 'string' ||
      !MOB_RANKS.includes(rank as MobRank) ||
      !['MAGE', 'WARRIOR', 'ARCHER'].includes(String(characterClass)) ||
      typeof renderScale !== 'number' ||
      !Number.isFinite(renderScale) ||
      renderScale < MIN_RENDER_SCALE ||
      renderScale > MAX_RENDER_SCALE ||
      !Number.isInteger(stats.experience) ||
      Number(stats.experience) < 0 ||
      !this.validStats(stats) ||
      !loot.every((entry) => this.validLootEntry(entry))
    ) {
      throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid', {
        reason: `Mob definition ${record.key} has malformed stats, scale or loot.`,
      });
    }
    return {
      id: record.id,
      definitionKey: record.key,
      name: record.name,
      rank: rank as MobRank,
      mapId: record.mapId,
      x: record.x,
      y: record.y,
      level: record.level,
      characterClass: characterClass as RuntimeMob['characterClass'],
      outfitKey: record.outfitKey,
      renderScale,
      respawnMs: Math.max(1_000, record.respawnMs),
      experience: Number(stats.experience),
      stats: {
        maxHp: Number(stats.maxHp),
        maxEnergy: Number(stats.maxEnergy),
        strength: Number(stats.strength),
        agility: Number(stats.agility),
        intelligence: Number(stats.intelligence),
        armor: Number(stats.armor),
      },
      loot: loot as MobLootEntry[],
      state: 'ALIVE',
    };
  }

  private validStats(stats: Partial<RuntimeMob['stats']>): boolean {
    return ['maxHp', 'maxEnergy', 'strength', 'agility', 'intelligence', 'armor'].every(
      (key) => {
        const value = stats[key as keyof RuntimeMob['stats']];
        return Number.isInteger(value) && Number(value) >= 0;
      },
    );
  }

  private validLootEntry(value: unknown): value is MobLootEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<MobLootEntry>;
    return (
      typeof entry.itemKey === 'string' &&
      entry.itemKey.length > 0 &&
      typeof entry.chance === 'number' &&
      entry.chance >= 0 &&
      entry.chance <= 1 &&
      Number.isInteger(entry.minQuantity) &&
      Number.isInteger(entry.maxQuantity) &&
      Number(entry.minQuantity) > 0 &&
      Number(entry.maxQuantity) >= Number(entry.minQuantity)
    );
  }
}
