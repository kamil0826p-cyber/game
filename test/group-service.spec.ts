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

function acceptInvite(service: GroupService, inviter: PlayerSession, member: PlayerSession): void {
  service.invite(inviter, member.characterId);
  const invite = service.getSnapshot(member).invites[0];
  expect(invite).toBeDefined();
  service.respond(member, invite!.inviteId, true);
}

describe('group service', () => {
  it('creates a group only after the invited player accepts and makes the creator admin', () => {
    const { sessions, service } = fixture();
    const admin = session('admin');
    const member = session('member', 1, 0);
    sessions.set(admin.characterId, admin);
    sessions.set(member.characterId, member);

    const inviterSnapshot = service.invite(admin, member.characterId);
    expect(inviterSnapshot.group).toBeNull();
    const invite = service.getSnapshot(member).invites[0];
    expect(invite).toBeDefined();

    const accepted = service.respond(member, invite!.inviteId, true);
    expect(accepted.group?.adminCharacterId).toBe(admin.characterId);
    expect(accepted.group?.members.map((entry) => entry.characterId)).toEqual([
      admin.characterId,
      member.characterId,
    ]);
    expect(accepted.group?.members[0]?.admin).toBe(true);
  });

  it('uses the shared adjacent-player range rule', () => {
    const { sessions, service } = fixture();
    const admin = session('admin');
    const distant = session('distant', 2, 0);
    sessions.set(admin.characterId, admin);
    sessions.set(distant.characterId, distant);

    expect(() => service.invite(admin, distant.characterId)).toThrow('GROUP_TOO_FAR');
  });

  it('does not allow an eleventh member', () => {
    const { sessions, service } = fixture();
    const admin = session('admin');
    sessions.set(admin.characterId, admin);

    for (let index = 1; index < 10; index += 1) {
      const member = session(`member-${index}`, 1, 0);
      sessions.set(member.characterId, member);
      acceptInvite(service, admin, member);
    }

    const overflow = session('overflow', 1, 0);
    sessions.set(overflow.characterId, overflow);
    expect(() => service.invite(admin, overflow.characterId)).toThrow('GROUP_FULL');
  });

  it('keeps an invitation available after a temporary acceptance failure', () => {
    const { sessions, service } = fixture();
    const admin = session('admin');
    const member = session('member', 1, 0);
    sessions.set(admin.characterId, admin);
    sessions.set(member.characterId, member);

    service.invite(admin, member.characterId);
    const invite = service.getSnapshot(member).invites[0]!;
    admin.activeInWorld = false;

    expect(() => service.respond(member, invite.inviteId, true)).toThrow(
      'GROUP_PARTICIPANT_UNAVAILABLE',
    );
    expect(service.getSnapshot(member).invites.map((entry) => entry.inviteId)).toContain(
      invite.inviteId,
    );
  });

  it('allows only the administrator to invite another player', () => {
    const { sessions, service } = fixture();
    const admin = session('admin');
    const member = session('member', 1, 0);
    const target = session('target', 1, 1);
    for (const player of [admin, member, target]) sessions.set(player.characterId, player);
    acceptInvite(service, admin, member);

    expect(() => service.invite(member, target.characterId)).toThrow('GROUP_FORBIDDEN');
    expect(() => service.invite(admin, target.characterId)).not.toThrow();
  });

  it('allows the administrator to remove a member and notifies the removed player', () => {
    const { sessions, publisher, service } = fixture();
    const admin = session('admin');
    const first = session('first', 1, 0);
    const second = session('second', 1, 1);
    for (const player of [admin, first, second]) sessions.set(player.characterId, player);
    acceptInvite(service, admin, first);
    acceptInvite(service, admin, second);

    const snapshot = service.kick(admin, first.characterId);

    expect(snapshot.group?.members.map((member) => member.characterId)).toEqual([
      admin.characterId,
      second.characterId,
    ]);
    expect(service.getSnapshot(first).group).toBeNull();
    expect(publisher.emit).toHaveBeenCalledWith(
      first.socketId,
      'group:updated',
      expect.objectContaining({ group: null }),
    );
  });

  it('does not allow a regular member to kick or the administrator to kick themselves', () => {
    const { sessions, service } = fixture();
    const admin = session('admin');
    const member = session('member', 1, 0);
    for (const player of [admin, member]) sessions.set(player.characterId, player);
    acceptInvite(service, admin, member);

    expect(() => service.kick(member, admin.characterId)).toThrow('GROUP_FORBIDDEN');
    expect(() => service.kick(admin, admin.characterId)).toThrow(
      'GROUP_ADMIN_CANNOT_KICK_SELF',
    );
  });

  it('transfers administration and invalidates invitations created by the previous admin', () => {
    const { sessions, service } = fixture();
    const admin = session('admin');
    const first = session('first', 1, 0);
    const second = session('second', 1, 1);
    const pending = session('pending', 0, 1);
    for (const player of [admin, first, second, pending]) sessions.set(player.characterId, player);
    acceptInvite(service, admin, first);
    acceptInvite(service, admin, second);
    service.invite(admin, pending.characterId);
    const pendingInvite = service.getSnapshot(pending).invites[0]!;

    service.leave(admin);

    expect(service.getSnapshot(first).group?.adminCharacterId).toBe(first.characterId);
    expect(() => service.respond(pending, pendingInvite.inviteId, true)).toThrow(
      'GROUP_INVITE_NOT_FOUND',
    );
  });

  it('dissolves a two-person group when either member leaves', () => {
    const { sessions, service } = fixture();
    const admin = session('admin');
    const member = session('member', 1, 0);
    sessions.set(admin.characterId, admin);
    sessions.set(member.characterId, member);
    acceptInvite(service, admin, member);

    expect(service.leave(member).group).toBeNull();
    expect(service.getSnapshot(admin).group).toBeNull();
  });
});
