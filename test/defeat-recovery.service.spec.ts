import { describe, expect, it, vi } from 'vitest';
import '../src/contracts/group-combat.events.js';
import type { CombatParticipantPayload, CombatSnapshot } from '../src/contracts/socket.events.js';
import {
  DEFEAT_RECOVERY_ENERGY_RATIO,
  DEFEAT_RECOVERY_HP_RATIO,
  DEFEAT_RECOVERY_MAP_KEY,
  DefeatRecoveryService,
} from '../src/modules/combat/defeat-recovery.service.js';
import type { MovementCoordinatorService } from '../src/modules/movement/movement-coordinator.service.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';
import type { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import type { WorldStateService } from '../src/modules/world/world-state.service.js';

const createSession = (): PlayerSession => ({
  socketId: 'socket-loser',
  connectionId: 'connection-loser',
  characterId: 'player-loser',
  userId: 'user-loser',
  realmId: 'realm-a',
  name: 'Fallen Hero',
  characterClass: 'WARRIOR',
  gender: 'MALE',
  level: 8,
  experience: 0,
  silver: 0,
  gold: 0,
  outfitKey: 'warrior-recruit',
  mapId: 'danger-map',
  x: 7,
  y: 7,
  direction: 'NORTH',
  combatState: 'IDLE',
  hp: 1,
  maxHp: 200,
  energy: 0,
  maxEnergy: 80,
  strength: 20,
  agility: 12,
  intelligence: 5,
  armor: 14,
  locale: 'pl',
  viewport: { halfWidth: 10, halfHeight: 8 },
  connectedAt: 0,
  nextMoveAllowedAt: 0,
  stateRevision: 4,
  persistedRevision: 4,
  dirty: false,
  activeInWorld: true,
  visibleCharacterIds: new Set<string>(),
  watcherCharacterIds: new Set<string>(),
});

const participant = (
  actorId: string,
  teamId: string,
  hp: number,
  characterId = actorId,
): CombatParticipantPayload => ({
  actorId,
  teamId,
  withdrawn: false,
  kind: 'PLAYER',
  characterId,
  name: actorId,
  characterClass: 'WARRIOR',
  level: 8,
  outfitKey: 'warrior-recruit',
  hp,
  maxHp: 200,
  energy: 0,
  maxEnergy: 80,
  shield: 0,
  statuses: [],
  skills: [],
});

const finalSnapshot = (): CombatSnapshot => ({
  combatId: 'combat-finished',
  status: 'FINISHED',
  zoneType: 'PVP',
  mapId: 'danger-map',
  createdAt: 1,
  startedAt: 2,
  finishedAt: 3,
  turnNumber: 7,
  winnerActorId: 'player-winner',
  winnerTeamId: 'team-winner',
  finishReason: 'DEFEATED',
  initiatorActorId: 'player-loser',
  recipientActorId: 'player-winner',
  participants: [
    participant('player-loser', 'team-loser', 0),
    participant('player-winner', 'team-winner', 80),
  ],
  recentActions: [],
});

describe('DefeatRecoveryService', () => {
  it('restores part of the defeated player resources and moves them to the infirmary once', async () => {
    const session = createSession();
    let observer:
      | ((socketId: string, snapshot: CombatSnapshot) => void | Promise<void>)
      | undefined;
    const transferToMap = vi.fn(async () => undefined);
    const emit = vi.fn();
    const service = new DefeatRecoveryService(
      { transferToMap } as unknown as MovementCoordinatorService,
      { getBySocketId: () => session } as unknown as WorldStateService,
      {
        observe: (_event: string, callback: typeof observer) => {
          observer = callback;
          return () => undefined;
        },
        emit,
      } as unknown as WorldEventsPublisher,
    );

    service.onModuleInit();
    expect(observer).toBeDefined();
    await observer!(session.socketId, finalSnapshot());
    await observer!(session.socketId, finalSnapshot());

    expect(session.hp).toBe(Math.ceil(session.maxHp * DEFEAT_RECOVERY_HP_RATIO));
    expect(session.energy).toBe(
      Math.ceil(session.maxEnergy * DEFEAT_RECOVERY_ENERGY_RATIO),
    );
    expect(session.stateRevision).toBe(5);
    expect(session.dirty).toBe(true);
    expect(transferToMap).toHaveBeenCalledOnce();
    expect(transferToMap).toHaveBeenCalledWith(session, DEFEAT_RECOVERY_MAP_KEY);
    expect(emit).toHaveBeenCalledWith(
      session.socketId,
      'notification',
      expect.objectContaining({ code: 'DEFEAT_RECOVERY' }),
    );
    service.onModuleDestroy();
  });


  it('treats a forfeit without team metadata as a defeat based on the winner actor', async () => {
    const session = createSession();
    session.hp = 120;
    let observer:
      | ((socketId: string, snapshot: CombatSnapshot) => void | Promise<void>)
      | undefined;
    const transferToMap = vi.fn(async () => undefined);
    const service = new DefeatRecoveryService(
      { transferToMap } as unknown as MovementCoordinatorService,
      { getBySocketId: () => session } as unknown as WorldStateService,
      {
        observe: (_event: string, callback: typeof observer) => {
          observer = callback;
          return () => undefined;
        },
        emit: vi.fn(),
      } as unknown as WorldEventsPublisher,
    );
    const snapshot = finalSnapshot();
    snapshot.finishReason = 'FORFEIT';
    snapshot.winnerTeamId = undefined;
    snapshot.participants[0].teamId = undefined;
    snapshot.participants[1].teamId = undefined;
    snapshot.participants[0].hp = 120;

    service.onModuleInit();
    await observer!(session.socketId, snapshot);

    expect(transferToMap).toHaveBeenCalledOnce();
    expect(transferToMap).toHaveBeenCalledWith(session, DEFEAT_RECOVERY_MAP_KEY);
    service.onModuleDestroy();
  });

  it('does not move the winning player', async () => {
    const session = createSession();
    session.characterId = 'player-winner';
    session.socketId = 'socket-winner';
    let observer:
      | ((socketId: string, snapshot: CombatSnapshot) => void | Promise<void>)
      | undefined;
    const transferToMap = vi.fn(async () => undefined);
    const service = new DefeatRecoveryService(
      { transferToMap } as unknown as MovementCoordinatorService,
      { getBySocketId: () => session } as unknown as WorldStateService,
      {
        observe: (_event: string, callback: typeof observer) => {
          observer = callback;
          return () => undefined;
        },
        emit: vi.fn(),
      } as unknown as WorldEventsPublisher,
    );

    service.onModuleInit();
    await observer!(session.socketId, finalSnapshot());

    expect(transferToMap).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });
});
