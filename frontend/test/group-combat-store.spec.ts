import { afterEach, describe, expect, it } from 'vitest';
import type { SelfCharacterState } from '../src/contracts/game';
import type { CombatParticipantPayload, CombatSnapshot } from '../src/contracts/socket';
import { gameStore } from '../src/game/state/gameStore';

const self = (): SelfCharacterState => ({
  characterId: 'self',
  name: 'Self',
  characterClass: 'WARRIOR',
  level: 10,
  experience: 0,
  silver: 0,
  gold: 0,
  outfitKey: 'warrior-recruit',
  mapId: 'map-a',
  x: 1,
  y: 1,
  direction: 'EAST',
  combatState: 'IN_BATTLE',
  hp: 100,
  maxHp: 100,
  energy: 50,
  maxEnergy: 50,
  strength: 10,
  agility: 10,
  intelligence: 10,
  armor: 10,
});

const participant = (
  actorId: string,
  teamId: string,
  overrides: Partial<CombatParticipantPayload> = {},
): CombatParticipantPayload => ({
  actorId,
  teamId,
  withdrawn: false,
  kind: 'PLAYER',
  characterId: actorId,
  name: actorId,
  characterClass: 'WARRIOR',
  level: 10,
  outfitKey: 'warrior-recruit',
  hp: 100,
  maxHp: 100,
  energy: 50,
  maxEnergy: 50,
  shield: 0,
  statuses: [],
  skills: [],
  ...overrides,
});

const combat = (participants: CombatParticipantPayload[]): CombatSnapshot => ({
  combatId: '00000000-0000-4000-8000-000000000001',
  status: 'ACTIVE',
  zoneType: 'PVP',
  mapId: 'map-a',
  createdAt: 1,
  startedAt: 1,
  turnNumber: 2,
  activeActorId: 'ally',
  initiatorActorId: 'self',
  recipientActorId: 'enemy',
  teams: [
    { teamId: 'a', anchorActorId: 'self', actorIds: ['self', 'ally'] },
    { teamId: 'b', anchorActorId: 'enemy', actorIds: ['enemy'] },
  ],
  participants: participants as unknown as [CombatParticipantPayload, CombatParticipantPayload],
  recentActions: [],
});

const setSelf = (character: SelfCharacterState): void => {
  const internal = gameStore as unknown as {
    patch(patch: { self: SelfCharacterState; plannedPath: Array<{ x: number; y: number }> }): void;
  };
  internal.patch({ self: character, plannedPath: [{ x: 2, y: 1 }] });
};

afterEach(() => gameStore.reset());

describe('group combat client state', () => {
  it('releases only the withdrawn local participant while the team fight continues', () => {
    setSelf(self());
    gameStore.updateCombatState(combat([
      participant('self', 'a', { hp: 0, withdrawn: true }),
      participant('ally', 'a'),
      participant('enemy', 'b'),
    ]));

    expect(gameStore.getSnapshot().self).toMatchObject({
      combatState: 'IDLE',
      hp: 1,
    });
    expect(gameStore.getSnapshot().plannedPath).toEqual([{ x: 2, y: 1 }]);
  });

  it('keeps an active local participant locked in battle', () => {
    setSelf(self());
    gameStore.updateCombatState(combat([
      participant('self', 'a'),
      participant('ally', 'a'),
      participant('enemy', 'b'),
    ]));

    expect(gameStore.getSnapshot().self?.combatState).toBe('IN_BATTLE');
    expect(gameStore.getSnapshot().plannedPath).toEqual([]);
  });
});
