import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { CombatSnapshot, MapStatePayload } from '../../contracts/socket.events.js';
import { MapService } from '../maps/map.service.js';
import type { RuntimeMap } from '../maps/runtime-map.types.js';
import { NpcService } from '../npcs/npc.service.js';
import { PlayerPersistenceService } from '../persistence/player-persistence.service.js';
import { VisibilityService } from '../world/visibility.service.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';

const HOSPITAL_MAP_KEY = 'hospital';
const PROCESSED_COMBAT_RETENTION_MS = 10 * 60_000;

@Injectable()
export class DefeatRecoveryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DefeatRecoveryService.name);
  private readonly processing = new Set<string>();
  private readonly processed = new Map<string, ReturnType<typeof setTimeout>>();
  private unsubscribe?: () => void;

  constructor(
    private readonly maps: MapService,
    private readonly npcs: NpcService,
    private readonly persistence: PlayerPersistenceService,
    private readonly visibility: VisibilityService,
    private readonly publisher: WorldEventsPublisher,
    private readonly world: WorldStateService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.publisher.onCombatUpdated((snapshot) =>
      this.processCombatUpdate(snapshot),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    for (const timer of this.processed.values()) clearTimeout(timer);
    this.processed.clear();
    this.processing.clear();
  }

  async processCombatUpdate(snapshot: CombatSnapshot): Promise<void> {
    if (
      snapshot.status !== 'FINISHED' ||
      this.processing.has(snapshot.combatId) ||
      this.processed.has(snapshot.combatId)
    ) {
      return;
    }

    const defeatedCharacterIds = [...snapshot.participants]
      .filter(
        (participant) =>
          participant.kind === 'PLAYER' &&
          typeof participant.characterId === 'string' &&
          participant.hp <= 0,
      )
      .map((participant) => participant.characterId!);

    if (defeatedCharacterIds.length === 0) {
      this.remember(snapshot.combatId);
      return;
    }

    this.processing.add(snapshot.combatId);
    try {
      const hospital = await this.maps.getMapByKey(HOSPITAL_MAP_KEY);
      const spawn = this.maps.findNearestWalkable(hospital, hospital.spawn);
      const hospitalNpcs = await this.npcs.getMapNpcs(hospital.id);

      for (const characterId of defeatedCharacterIds) {
        const session = this.world.getByCharacterId(characterId);
        if (!session) {
          this.logger.warn(
            `Defeated character ${characterId} is offline; hospital transfer will occur on the next active defeat event.`,
          );
          continue;
        }

        const transferredAt = Date.now();
        const previous = this.world.updatePosition(session, {
          mapId: hospital.id,
          x: spawn.x,
          y: spawn.y,
          direction: 'NORTH',
        });
        const nearbyPlayers = session.activeInWorld
          ? this.visibility.afterMovement(session, previous, true, transferredAt)
          : [];

        if (session.activeInWorld) {
          this.publisher.emit(session.socketId, 'world:mapChanged', {
            map: this.toMapState(hospital),
            npcs: hospitalNpcs,
            self: this.world.toSelfState(session),
            nearbyPlayers,
            serverTime: transferredAt,
          });
          this.publisher.emit(session.socketId, 'notification', {
            code: 'DEFEAT_RECOVERY',
            message:
              session.locale === 'pl'
                ? 'Po porażce odzyskujesz przytomność w mrocznej lecznicy.'
                : 'After your defeat, you regain consciousness in the dark infirmary.',
          });
        }

        const persisted = await this.persistence.persistSession(session, 'combat');
        this.world.markPersisted(
          persisted.characterId,
          persisted.connectionId,
          persisted.revision,
        );
      }

      this.remember(snapshot.combatId);
    } catch (error) {
      this.logger.error(
        `Could not transfer defeated combatants from ${snapshot.combatId} to the hospital.`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.processing.delete(snapshot.combatId);
    }
  }

  private remember(combatId: string): void {
    if (this.processed.has(combatId)) return;
    const timer = setTimeout(() => this.processed.delete(combatId), PROCESSED_COMBAT_RETENTION_MS);
    timer.unref?.();
    this.processed.set(combatId, timer);
  }

  private toMapState(map: RuntimeMap): MapStatePayload {
    return {
      id: map.id,
      key: map.key,
      name: map.name,
      width: map.width,
      height: map.height,
      zoneType: map.zoneType,
      version: map.version,
    };
  }
}
