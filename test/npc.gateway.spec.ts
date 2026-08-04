import { describe, expect, it, vi } from 'vitest';
import type { GameSocket, NpcDialogueSnapshot } from '../src/contracts/socket.events.js';
import type { LocalizationService } from '../src/i18n/localization.service.js';
import type { CombatOccupancyService } from '../src/modules/combat/combat-occupancy.service.js';
import type { ItemService } from '../src/modules/items/item.service.js';
import { ItemGateway } from '../src/modules/items/item.gateway.js';
import type { MovementCoordinatorService } from '../src/modules/movement/movement-coordinator.service.js';
import { NpcGateway } from '../src/modules/npcs/npc.gateway.js';
import type { NpcService } from '../src/modules/npcs/npc.service.js';
import type { WorldStateService } from '../src/modules/world/world-state.service.js';

const npcId = '11111111-1111-4111-8111-111111111111';
const dialogue: NpcDialogueSnapshot = {
  npc: { id: npcId, key: 'merchant', name: 'Borin' },
  node: {
    id: 'welcome',
    text: 'Welcome',
    choices: [{ id: 'shop', label: 'Shop' }],
  },
};
const session = {
  activeInWorld: true,
  userId: 'user-1',
  characterId: 'character-1',
  mapId: 'map-a',
  x: 10,
  y: 10,
};
const localization = {
  translate: vi.fn((key: string) => key),
} as unknown as LocalizationService;
const movement = {
  runSerialized: vi.fn(async (_session: unknown, operation: () => Promise<unknown>) =>
    operation(),
  ),
} as unknown as MovementCoordinatorService;
const occupancy = {
  isOccupied: vi.fn().mockReturnValue(false),
} as unknown as CombatOccupancyService;
const worldState = {
  getBySocketId: vi.fn().mockReturnValue(session),
} as unknown as WorldStateService;

function client(): GameSocket {
  return {
    id: 'socket-1',
    data: { sessionState: 'IN_WORLD', locale: 'en' },
  } as unknown as GameSocket;
}

describe('NPC gateway authorization', () => {
  it('tracks the current node and grants access only after the merchant choice', async () => {
    const npcs = {
      startDialogue: vi.fn().mockResolvedValue(dialogue),
      chooseDialogue: vi.fn().mockResolvedValue({
        type: 'ACTION',
        action: { type: 'OPEN_MERCHANT', npcId },
      }),
    } as unknown as NpcService;
    const gateway = new NpcGateway(npcs, worldState, movement, localization);
    const socket = client();

    await expect(
      gateway.startDialogue(socket, { requestId: 'start-1', npcId }),
    ).resolves.toEqual({ ok: true, data: dialogue });
    expect(socket.data.activeNpcDialogue).toEqual({ npcId, nodeId: 'welcome' });
    expect(socket.data.merchantNpcId).toBeUndefined();

    const response = await gateway.chooseDialogue(socket, {
      requestId: 'choice-1',
      npcId,
      nodeId: 'welcome',
      choiceId: 'shop',
    });
    expect(response).toMatchObject({
      ok: true,
      data: { type: 'ACTION', action: { type: 'OPEN_MERCHANT', npcId } },
    });
    expect(socket.data.activeNpcDialogue).toBeUndefined();
    expect(socket.data.merchantNpcId).toBe(npcId);
  });

  it('rejects a choice that is not the active dialogue node', async () => {
    const npcs = { chooseDialogue: vi.fn() } as unknown as NpcService;
    const gateway = new NpcGateway(npcs, worldState, movement, localization);
    const response = await gateway.chooseDialogue(client(), {
      requestId: 'choice-1',
      npcId,
      nodeId: 'welcome',
      choiceId: 'shop',
    });
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'NPC_DIALOGUE_STATE_INVALID',
        message: 'errors.npcs.dialogueStateInvalid',
        details: undefined,
      },
    });
    expect(npcs.chooseDialogue).not.toHaveBeenCalled();
  });

  it('blocks merchant calls that were not unlocked by dialogue', async () => {
    const items = { getMerchant: vi.fn() } as unknown as ItemService;
    const gateway = new ItemGateway(items, worldState, movement, occupancy, localization);
    const response = await gateway.getMerchant(client(), {
      requestId: 'merchant-1',
      npcId,
    });
    expect(response).toEqual({
      ok: false,
      error: {
        code: 'MERCHANT_NOT_AVAILABLE',
        message: 'errors.items.merchantUnavailable',
        details: undefined,
      },
    });
    expect(items.getMerchant).not.toHaveBeenCalled();
  });
});
