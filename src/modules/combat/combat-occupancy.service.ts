import { Injectable } from '@nestjs/common';

@Injectable()
export class CombatOccupancyService {
  private readonly combatIdByActor = new Map<string, string>();

  getCombatId(actorId: string): string | undefined {
    return this.combatIdByActor.get(actorId);
  }

  isOccupied(actorId: string, expectedCombatId?: string): boolean {
    const combatId = this.combatIdByActor.get(actorId);
    return combatId !== undefined && combatId !== expectedCombatId;
  }

  reserve(actorIds: Iterable<string>, combatId: string): void {
    const ids = [...new Set(actorIds)];
    if (ids.some((actorId) => this.isOccupied(actorId, combatId))) {
      throw new Error('COMBAT_OCCUPANCY_CONFLICT');
    }
    for (const actorId of ids) this.combatIdByActor.set(actorId, combatId);
  }

  release(actorId: string, combatId: string): void {
    if (this.combatIdByActor.get(actorId) === combatId) this.combatIdByActor.delete(actorId);
  }

  releaseMany(actorIds: Iterable<string>, combatId: string): void {
    for (const actorId of actorIds) this.release(actorId, combatId);
  }
}
