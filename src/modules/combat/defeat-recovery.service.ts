import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import '../../contracts/group-combat.events.js';
import type { CombatSnapshot } from '../../contracts/socket.events.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';

export const DEFEAT_RECOVERY_MAP_KEY = 'ashen-infirmary';
export const DEFEAT_RECOVERY_HP_RATIO = 0.35;
export const DEFEAT_RECOVERY_ENERGY_RATIO = 0.25;

const PROCESSED_RESULT_RETENTION_MS = 10 * 60_000;
const RECOVERY_FINISH_REASONS = new Set(['DEFEATED', 'FORFEIT', 'DISCONNECTED']);

@Injectable()
export class DefeatRecoveryService implements OnModuleInit, OnModuleDestroy {
  private unsubscribe?: () => void;
  private readonly processedResults = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly movement: MovementCoordinatorService,
    private readonly world: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.publisher.observe(
      'combat:updated',
      (socketId, snapshot) => this.handleCombatUpdate(socketId, snapshot),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    for (const timer of this.processedResults.values()) clearTimeout(timer);
    this.processedResults.clear();
  }

  private async handleCombatUpdate(
    socketId: string,
    snapshot: CombatSnapshot,
  ): Promise<void> {
    if (
      snapshot.status !== 'FINISHED' ||
      !snapshot.finishReason ||
      !RECOVERY_FINISH_REASONS.has(snapshot.finishReason)
    ) {
      return;
    }

    const session = this.world.getBySocketId(socketId);
    if (!session?.activeInWorld) return;
    const participant = snapshot.participants.find(
      (candidate) => candidate.characterId === session.characterId,
    );
    if (!participant || participant.kind !== 'PLAYER') return;

    const playerLost = snapshot.winnerTeamId
      ? participant.teamId !== undefined
        ? participant.teamId !== snapshot.winnerTeamId
        : participant.actorId !== snapshot.winnerActorId
      : participant.hp <= 0;
    if (!playerLost) return;

    const resultKey = `${snapshot.combatId}:${session.characterId}`;
    if (this.processedResults.has(resultKey)) return;
    const retentionTimer = setTimeout(
      () => this.processedResults.delete(resultKey),
      PROCESSED_RESULT_RETENTION_MS,
    );
    retentionTimer.unref?.();
    this.processedResults.set(resultKey, retentionTimer);

    try {
      const recoveredHp = Math.max(1, Math.ceil(session.maxHp * DEFEAT_RECOVERY_HP_RATIO));
      const recoveredEnergy = Math.max(
        0,
        Math.ceil(session.maxEnergy * DEFEAT_RECOVERY_ENERGY_RATIO),
      );
      if (session.hp !== recoveredHp || session.energy !== recoveredEnergy) {
        session.hp = recoveredHp;
        session.energy = recoveredEnergy;
        session.stateRevision += 1;
        session.dirty = true;
      }

      await this.movement.transferToMap(session, DEFEAT_RECOVERY_MAP_KEY);
      this.publisher.emit(session.socketId, 'notification', {
        code: 'DEFEAT_RECOVERY',
        message:
          session.locale === 'pl'
            ? 'Ocknąłeś się w Lazarecie Popielnych. Uzdrowiciele przywrócili ci część sił.'
            : 'You awaken in the Ashen Infirmary. Its healers restored part of your strength.',
      });
    } catch (error) {
      const timer = this.processedResults.get(resultKey);
      if (timer) clearTimeout(timer);
      this.processedResults.delete(resultKey);
      throw error;
    }
  }
}
