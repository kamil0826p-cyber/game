import type {
  CombatActionResolutionPayload,
  CombatSnapshot,
} from '../../contracts/socket.events.js';
import {
  cachedEquippedItemCurseModifiers,
  queueItemCurseCorruption,
} from '../items/item-curse-runtime.service.js';
import { CombatEngine } from './combat.engine.js';
import type { CombatRuntime, CombatRuntimeActor } from './combat.types.js';

interface CurseCombatState {
  pendingTelegraphs: Map<string, number>;
  combatEndApplied: Set<string>;
}

const PATCH_FLAG = Symbol.for('game.item-curse-combat-patch.v1');
const states = new WeakMap<CombatRuntime, CurseCombatState>();

const stateFor = (runtime: CombatRuntime): CurseCombatState => {
  const existing = states.get(runtime);
  if (existing) return existing;
  const created: CurseCombatState = {
    pendingTelegraphs: new Map(),
    combatEndApplied: new Set(),
  };
  states.set(runtime, created);
  return created;
};

const playerActor = (
  runtime: CombatRuntime,
  actorId: string,
): CombatRuntimeActor | undefined =>
  runtime.actors.find(
    (actor) => actor.actorId === actorId && actor.kind === 'PLAYER' && actor.characterId,
  );

const hasGuard = (actor: CombatRuntimeActor): boolean =>
  actor.statuses.some((status) => status.key === 'GUARD' && status.turnsRemaining > 0);

const queueTrigger = (
  runtime: CombatRuntime,
  actor: CombatRuntimeActor | undefined,
  trigger: 'SKILL_CAST' | 'GUARD_SUCCESS' | 'COMBAT_END',
  operationId: string,
): void => {
  if (!actor?.characterId) return;
  const modifiers = cachedEquippedItemCurseModifiers(actor.characterId);
  queueItemCurseCorruption(
    actor.characterId,
    modifiers.corruptionByTrigger[trigger],
    operationId,
  );
};

const adjustReceivedHealing = (
  runtime: CombatRuntime,
  event: CombatActionResolutionPayload,
): void => {
  for (const result of event.results) {
    if (result.hpDelta <= 0) continue;
    const target = playerActor(runtime, result.targetActorId);
    if (!target?.characterId) continue;
    const multiplier = cachedEquippedItemCurseModifiers(
      target.characterId,
    ).healingReceivedMultiplier;
    if (multiplier >= 1) continue;
    const received = Math.max(0, Math.round(result.hpDelta * multiplier));
    const removed = result.hpDelta - received;
    if (removed <= 0) continue;
    target.hp = Math.max(0, target.hp - removed);
    result.hpDelta = received;
  }
};

const applySkillCastTrigger = (
  runtime: CombatRuntime,
  state: CurseCombatState,
  event: CombatActionResolutionPayload,
): void => {
  if (event.action !== 'SKILL' || !event.skillKey) return;
  if (event.skillKey.startsWith('tactical:')) return;
  const actor = playerActor(runtime, event.actorId);
  if (!actor) return;
  if (event.skillKey.startsWith('telegraph:')) {
    const skillKey = event.skillKey.slice('telegraph:'.length);
    const key = `${event.actorId}:${skillKey}`;
    state.pendingTelegraphs.set(key, (state.pendingTelegraphs.get(key) ?? 0) + 1);
    queueTrigger(
      runtime,
      actor,
      'SKILL_CAST',
      `combat:${runtime.combatId}:curse:${actor.actorId}:skill:${event.sequence}`,
    );
    return;
  }
  const key = `${event.actorId}:${event.skillKey}`;
  const pending = state.pendingTelegraphs.get(key) ?? 0;
  if (pending > 0) {
    if (pending === 1) state.pendingTelegraphs.delete(key);
    else state.pendingTelegraphs.set(key, pending - 1);
    return;
  }
  queueTrigger(
    runtime,
    actor,
    'SKILL_CAST',
    `combat:${runtime.combatId}:curse:${actor.actorId}:skill:${event.sequence}`,
  );
};

const applyGuardTriggers = (
  runtime: CombatRuntime,
  event: CombatActionResolutionPayload,
): void => {
  event.results.forEach((result, index) => {
    if (result.hpDelta >= 0 && result.shieldAbsorbed <= 0) return;
    const target = playerActor(runtime, result.targetActorId);
    if (!target || !hasGuard(target)) return;
    queueTrigger(
      runtime,
      target,
      'GUARD_SUCCESS',
      `combat:${runtime.combatId}:curse:${target.actorId}:guard:${event.sequence}:${index}`,
    );
  });
};

const processEvents = (
  runtime: CombatRuntime,
  state: CurseCombatState,
  firstSequence: number,
): void => {
  const events = runtime.events.filter((event) => event.sequence >= firstSequence);
  for (const event of events) {
    adjustReceivedHealing(runtime, event);
    applySkillCastTrigger(runtime, state, event);
    applyGuardTriggers(runtime, event);
  }
  if (!runtime.telegraph) state.pendingTelegraphs.clear();
};

const applyCombatEndTrigger = (
  runtime: CombatRuntime,
  state: CurseCombatState,
): void => {
  if (runtime.startedAt === undefined) return;
  if (runtime.status !== 'FINISHED' && runtime.status !== 'CANCELLED') return;
  for (const actor of runtime.actors) {
    if (actor.kind !== 'PLAYER' || !actor.characterId) continue;
    if (state.combatEndApplied.has(actor.actorId)) continue;
    state.combatEndApplied.add(actor.actorId);
    queueTrigger(
      runtime,
      actor,
      'COMBAT_END',
      `combat:${runtime.combatId}:curse:${actor.actorId}:end`,
    );
  }
};

const finalize = (
  engine: CombatEngine,
  runtime: CombatRuntime,
  firstSequence: number,
): CombatSnapshot => {
  const state = stateFor(runtime);
  processEvents(runtime, state, firstSequence);
  applyCombatEndTrigger(runtime, state);
  return engine.snapshot(runtime);
};

const prototype = CombatEngine.prototype;
const marker = prototype as unknown as Record<PropertyKey, unknown>;
if (!marker[PATCH_FLAG]) {
  marker[PATCH_FLAG] = true;

  const originalAct = prototype.act;
  prototype.act = function (
    this: CombatEngine,
    ...args: Parameters<CombatEngine['act']>
  ): ReturnType<CombatEngine['act']> {
    const runtime = args[0];
    const firstSequence = runtime.nextSequence;
    originalAct.apply(this, args);
    return finalize(this, runtime, firstSequence);
  };

  const originalTimeout = prototype.timeout;
  prototype.timeout = function (
    this: CombatEngine,
    ...args: Parameters<CombatEngine['timeout']>
  ): ReturnType<CombatEngine['timeout']> {
    const runtime = args[0];
    const firstSequence = runtime.nextSequence;
    originalTimeout.apply(this, args);
    return finalize(this, runtime, firstSequence);
  };

  const originalResolveTelegraph = prototype.resolveTelegraph;
  prototype.resolveTelegraph = function (
    this: CombatEngine,
    ...args: Parameters<CombatEngine['resolveTelegraph']>
  ): ReturnType<CombatEngine['resolveTelegraph']> {
    const runtime = args[0];
    const firstSequence = runtime.nextSequence;
    originalResolveTelegraph.apply(this, args);
    return finalize(this, runtime, firstSequence);
  };

  const originalForfeit = prototype.forfeit;
  prototype.forfeit = function (
    this: CombatEngine,
    ...args: Parameters<CombatEngine['forfeit']>
  ): ReturnType<CombatEngine['forfeit']> {
    const runtime = args[0];
    const firstSequence = runtime.nextSequence;
    originalForfeit.apply(this, args);
    return finalize(this, runtime, firstSequence);
  };

  const originalTerminate = prototype.terminate;
  prototype.terminate = function (
    this: CombatEngine,
    ...args: Parameters<CombatEngine['terminate']>
  ): ReturnType<CombatEngine['terminate']> {
    const runtime = args[0];
    const firstSequence = runtime.nextSequence;
    originalTerminate.apply(this, args);
    return finalize(this, runtime, firstSequence);
  };
}
