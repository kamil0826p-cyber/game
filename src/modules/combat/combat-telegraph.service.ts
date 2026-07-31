import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { CombatSnapshot } from '../../contracts/socket.events.js';
import type { ActiveCombatTelegraph, MobTelegraphDefinition } from '../mobs/mob-ai.types.js';
import type { CombatActionCommand } from './combat.types.js';

interface PendingCombatTelegraph extends ActiveCombatTelegraph {
  command: CombatActionCommand;
}

export type CombatSnapshotWithTelegraphs = CombatSnapshot & {
  telegraphs: ActiveCombatTelegraph[];
};

@Injectable()
export class CombatTelegraphService {
  private readonly byCombatId = new Map<string, Map<string, PendingCombatTelegraph>>();

  prepare(
    combatId: string,
    actorId: string,
    targetActorId: string | undefined,
    command: CombatActionCommand,
    currentTurn: number,
    definition: MobTelegraphDefinition,
  ): ActiveCombatTelegraph {
    const combat = this.byCombatId.get(combatId) ?? new Map<string, PendingCombatTelegraph>();
    this.byCombatId.set(combatId, combat);
    for (const pending of combat.values()) {
      if (pending.actorId === actorId) {
        throw new Error(`Actor ${actorId} already has an active telegraph.`);
      }
    }

    const telegraph: PendingCombatTelegraph = {
      id: randomUUID(),
      key: definition.key,
      actorId,
      ...(targetActorId ? { targetActorId } : {}),
      ...(command.skillKey ? { skillKey: command.skillKey } : {}),
      createdTurn: currentTurn,
      resolvesOnTurn: currentTurn + Math.max(1, definition.resolveAfterTurns),
      counterKinds: [...definition.counterKinds],
      publicMetadata: { ...(definition.publicMetadata ?? {}) },
      command: { ...command },
    };
    combat.set(telegraph.id, telegraph);
    return this.toPublic(telegraph);
  }

  resolveReady(
    combatId: string,
    actorId: string,
    currentTurn: number,
  ): CombatActionCommand | undefined {
    const combat = this.byCombatId.get(combatId);
    if (!combat) return undefined;
    const ready = [...combat.values()]
      .filter(
        (telegraph) =>
          telegraph.actorId === actorId && telegraph.resolvesOnTurn <= currentTurn,
      )
      .sort(
        (left, right) =>
          left.resolvesOnTurn - right.resolvesOnTurn || left.id.localeCompare(right.id),
      )[0];
    if (!ready) return undefined;
    combat.delete(ready.id);
    if (combat.size === 0) this.byCombatId.delete(combatId);
    return { ...ready.command };
  }

  counter(
    combatId: string,
    telegraphId: string,
    counterKind: ActiveCombatTelegraph['counterKinds'][number],
  ): boolean {
    const combat = this.byCombatId.get(combatId);
    const telegraph = combat?.get(telegraphId);
    if (!combat || !telegraph || !telegraph.counterKinds.includes(counterKind)) return false;
    combat.delete(telegraphId);
    if (combat.size === 0) this.byCombatId.delete(combatId);
    return true;
  }

  removeActor(combatId: string, actorId: string): void {
    const combat = this.byCombatId.get(combatId);
    if (!combat) return;
    for (const [id, telegraph] of combat) {
      if (telegraph.actorId === actorId || telegraph.targetActorId === actorId) combat.delete(id);
    }
    if (combat.size === 0) this.byCombatId.delete(combatId);
  }

  clear(combatId: string): void {
    this.byCombatId.delete(combatId);
  }

  list(combatId: string): ActiveCombatTelegraph[] {
    return [...(this.byCombatId.get(combatId)?.values() ?? [])]
      .sort(
        (left, right) =>
          left.resolvesOnTurn - right.resolvesOnTurn || left.id.localeCompare(right.id),
      )
      .map((telegraph) => this.toPublic(telegraph));
  }

  decorate(snapshot: CombatSnapshot): CombatSnapshotWithTelegraphs {
    return {
      ...snapshot,
      telegraphs: this.list(snapshot.combatId),
    };
  }

  private toPublic(telegraph: PendingCombatTelegraph): ActiveCombatTelegraph {
    const { command: _command, ...publicTelegraph } = telegraph;
    return {
      ...publicTelegraph,
      counterKinds: [...publicTelegraph.counterKinds],
      publicMetadata: { ...publicTelegraph.publicMetadata },
    };
  }
}
