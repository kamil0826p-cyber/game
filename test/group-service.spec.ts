import { describe, expect, it, vi } from 'vitest';
import type { PlayerSession } from '../src/modules/world/player-session.types.js';
import { GroupService } from '../src/modules/groups/group.service.js';
import type { WorldEventsPublisher } from '../src/modules/world/world-events.publisher.js';
import type { WorldStateService } from '../src/modules/world/world-state.service.js';

function session(characterId: string, x = 0, y = 0): PlayerSession {
  return {
    characterId,
    userId: `user-${characterId}`,
    socketId: `socket-${characterId}`,
    connectionId: `connection-${characterId}`,
    realmId: 'realm-a',
    name: characterId,
    characterClass: 'WARRIOR',
    level: 5,
    experience: 0,
    silver: 0,
    gold: 0,
    outfitKey: 'warrior-default',
    mapId: 'map-a',
    x,
    y,
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

function fixture() {
  const sessions = new Map<string, PlayerSession>();
  const world = {
    getByCharacterId: (characterId: string) => sessions.get(characterId),
  } as unknown as WorldStateService;
  const publisher = { emit: vi.fn() } as unknown as WorldEventsPublisher;
  return { sessions, publisher, service: new GroupService(world, publisher) };
}

describe('group service', () => {
  it('creates a group only after the invited player accepts', () => {
    const { sessions, service } = fixture();
    const leader = session('leader');
    const member = session('member', 1, 0);
    sessions.set(leader.characterId, leader);
    sessions.set(member.characterId, member);

    const inviterSnapshot = service.invite(leader, member.characterId);
    expect(inviterSnapshot.group).toBeNull();
    const invite = service.getSnapshot(member).invites[0];
    expect(invite).toBeDefined();

    const accepted = service.respond(member, invite!.inviteId, true);
    expect(accepted.group?.members.map((entry) => entry.characterId)).toEqual([
      leader.characterId,
      member.characterId,
    ]);
    expect(accepted.group?.members[0]?.leader).toBe(true);
  });

  it('uses the shared adjacent-player range rule', () => {
    const { sessions, service } = fixture();
    const leader = session('leader');
    const distant = session('distant', 2, 0);
    sessions.set(leader.characterId, leader);
    sessions.set(distant.characterId, distant);

    expect(() => service.invite(leader, distant.characterId)).toThrow('GROUP_TOO_FAR');
  });

  it('does not allow an eleventh member', () => {
    const { sessions, service } = fixture();
    const leader = session('leader');
    sessions.set(leader.characterId, leader);

    for (let index = 1; index < 10; index += 1) {
      const member = session(`member-${index}`, 1, 0);
      sessions.set(member.characterId, member);
      service.invite(leader, member.characterId);
      const invite = service.getSnapshot(member).invites[0]!;
      service.respond(member, invite.inviteId, true);
    }

    const overflow = session('overflow', 1, 0);
    sessions.set(overflow.characterId, overflow);
    expect(() => service.invite(leader, overflow.characterId)).toThrow('GROUP_FULL');
  });

  it('keeps an invitation available after a temporary acceptance failure', () => {
    const { sessions, service } = fixture();
    const leader = session('leader');
    const member = session('member', 1, 0);
    sessions.set(leader.characterId, leader);
    sessions.set(member.characterId, member);

    service.invite(leader, member.characterId);
    const invite = service.getSnapshot(member).invites[0]!;
    leader.activeInWorld = false;

    expect(() => service.respond(member, invite.inviteId, true)).toThrow(
      'GROUP_PARTICIPANT_UNAVAILABLE',
    );
    expect(service.getSnapshot(member).invites.map((entry) => entry.inviteId)).toContain(
      invite.inviteId,
    );
  });

  it('dissolves a two-person group when either member leaves', () => {
    const { sessions, service } = fixture();
    const leader = session('leader');
    const member = session('member', 1, 0);
    sessions.set(leader.characterId, leader);
    sessions.set(member.characterId, member);

    service.invite(leader, member.characterId);
    const invite = service.getSnapshot(member).invites[0]!;
    service.respond(member, invite.inviteId, true);

    expect(service.leave(member).group).toBeNull();
    expect(service.getSnapshot(leader).group).toBeNull();
  });
});
