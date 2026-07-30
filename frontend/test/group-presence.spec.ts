import { afterEach, describe, expect, it, vi } from 'vitest';
import { isGroupMate, subscribeGroupPresence } from '../src/game/groups/groupPresence';
import { groupStore } from '../src/game/state/groupStore';

afterEach(() => groupStore.reset());

describe('group presence', () => {
  it('tracks character ids from the current authoritative group snapshot', () => {
    groupStore.setSnapshot({
      group: {
        id: 'group-a',
        adminCharacterId: 'self',
        maxMembers: 10,
        members: [
          {
            characterId: 'self',
            name: 'Self',
            characterClass: 'WARRIOR',
            level: 10,
            outfitKey: 'warrior-default',
            hp: 100,
            maxHp: 100,
            online: true,
            admin: true,
          },
          {
            characterId: 'ally',
            name: 'Ally',
            characterClass: 'ARCHER',
            level: 9,
            outfitKey: 'archer-default',
            hp: 80,
            maxHp: 90,
            online: true,
            admin: false,
          },
        ],
      },
      invites: [],
    });

    expect(isGroupMate('ally')).toBe(true);
    expect(isGroupMate('stranger')).toBe(false);
  });

  it('notifies character views when group membership changes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeGroupPresence(listener);

    groupStore.setSnapshot({ group: null, invites: [] });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    groupStore.setSnapshot({ group: null, invites: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
