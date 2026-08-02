import { describe, expect, it, vi } from 'vitest';
import { GroupService } from '../src/modules/groups/group.service.js';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';
import type { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import type { WorldStateService } from '../src/modules/world/world-state.service.js';

function session(characterId: string): PlayerSession {
  return {
    characterId,
    userId: `user-${characterId}`,
    socketId: `socket-${characterId}`,
    connectionId: `connection-${characterId}`,
    realmId: '11111111-1111-4111-8111-111111111111',
    name: characterId,
    characterClass: 'WARRIOR',
    gender: 'MALE',
    level: 10,
    experience: 0,
    silver: 0,
    gold: 0,
    outfitKey: 'warrior-default',
    mapId: '22222222-2222-4222-8222-222222222222',
    x: 0,
    y: 0,
    direction: 'SOUTH',
    combatState: 'IDLE',
    hp: 100,
    maxHp: 100,
    energy: 50,
    maxEnergy: 50,
    strength: 10,
    agility: 10,
    intelligence: 10,
    armor: 10,
    locale: 'pl',
    viewport: { halfWidth: 10, halfHeight: 8 },
    connectedAt: Date.now(),
    nextMoveAllowedAt: 0,
    stateRevision: 0,
    persistedRevision: 0,
    dirty: false,
    activeInWorld: true,
    visibleCharacterIds: new Set(),
    watcherCharacterIds: new Set(),
  };
}

function fixture(players: PlayerSession[]) {
  const sessions = new Map(players.map((player) => [player.characterId, player]));
  const world = {
    getByCharacterId: (characterId: string) => sessions.get(characterId),
  } as unknown as WorldStateService;
  const publisher = { emit: vi.fn() } as unknown as WorldEventsPublisher;
  return { service: new GroupService(world, publisher), publisher };
}

describe('group finder roster assembly', () => {
  it('supports a solo activity without creating a synthetic group', () => {
    const leader = session('leader');
    const { service } = fixture([leader]);
    expect(service.getActivityRoster(leader).map((member) => member.characterId)).toEqual(['leader']);
    expect(service.assembleFinderRoster(leader, ['leader']).group).toBeNull();
  });

  it('atomically creates a remote finder group for an exact validated roster', () => {
    const leader = session('leader');
    const first = session('first');
    const second = session('second');
    const { service, publisher } = fixture([leader, first, second]);
    const snapshot = service.assembleFinderRoster(leader, ['leader', 'first', 'second']);
    expect(snapshot.group?.adminCharacterId).toBe('leader');
    expect(snapshot.group?.members.map((member) => member.characterId).sort()).toEqual([
      'first', 'leader', 'second',
    ]);
    expect(publisher.emit).toHaveBeenCalledTimes(3);
  });

  it('rejects overflow, duplicate conflicts and unavailable participants before mutating', () => {
    const players = Array.from({ length: 11 }, (_, index) => session(`player-${index}`));
    const { service } = fixture(players);
    expect(() => service.assembleFinderRoster(players[0]!, players.map((player) => player.characterId)))
      .toThrow('INVALID_PAYLOAD');
    players[1]!.combatState = 'IN_BATTLE';
    expect(() => service.assembleFinderRoster(players[0]!, ['player-0', 'player-1']))
      .toThrow('GROUP_PARTICIPANT_UNAVAILABLE');
    expect(service.getSnapshot(players[0]!).group).toBeNull();
  });

  it('allows only the current group administrator to expand an existing roster', () => {
    const leader = session('leader');
    const member = session('member');
    const candidate = session('candidate');
    const { service } = fixture([leader, member, candidate]);
    service.assembleFinderRoster(leader, ['leader', 'member']);
    expect(() => service.assembleFinderRoster(member, ['leader', 'member', 'candidate']))
      .toThrow('GROUP_FORBIDDEN');
    expect(service.assembleFinderRoster(leader, ['leader', 'member', 'candidate']).group?.members)
      .toHaveLength(3);
  });
});
