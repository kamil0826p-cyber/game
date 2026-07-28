import { describe, expect, it, vi } from 'vitest';
import { GAME_ERROR_CODES, GameError } from '../src/common/errors/game.error.js';
import type { PrismaService } from '../src/database/prisma.service.js';
import { NpcService } from '../src/modules/npcs/npc.service.js';

const npc = {
  id: '11111111-1111-4111-8111-111111111111',
  mapId: 'map-a',
  key: 'merchant',
  name: 'Borin',
  x: 10,
  y: 10,
  outfitKey: 'merchant',
  createdAt: new Date(),
  updatedAt: new Date(),
  dialogue: {
    type: 'MERCHANT',
    interactionRadius: 2,
    rootNodeId: 'welcome',
    nodes: {
      welcome: {
        text: { pl: 'Witaj.', en: 'Welcome.' },
        choices: [
          { id: 'ask', label: { pl: 'Zapytaj', en: 'Ask' }, nextNodeId: 'answer' },
          { id: 'shop', label: { pl: 'Towary', en: 'Wares' }, action: 'OPEN_MERCHANT' },
        ],
      },
      answer: {
        text: { pl: 'Odpowiedź.', en: 'Answer.' },
        choices: [{ id: 'leave', label: { pl: 'Żegnaj', en: 'Goodbye' }, action: 'CLOSE' }],
      },
    },
    merchant: { itemKeys: ['field-rations'], infiniteStock: true },
  },
};

function createService(record = npc): NpcService {
  return new NpcService({
    npcDefinition: { findUnique: vi.fn().mockResolvedValue(record) },
  } as unknown as PrismaService);
}

describe('NpcService dialogue flow', () => {
  it('publishes the shared interaction radius for merchant NPCs', async () => {
    const service = new NpcService({
      npcDefinition: { findMany: vi.fn().mockResolvedValue([npc]) },
    } as unknown as PrismaService);
    await expect(service.getMapNpcs('map-a')).resolves.toEqual([
      expect.objectContaining({
        id: npc.id,
        interactionType: 'MERCHANT',
        interactionRadius: 2,
      }),
    ]);
  });

  it('starts at the configured root and resolves a branch', async () => {
    const service = createService();
    const position = { mapId: 'map-a', x: 8, y: 9 };
    const started = await service.startDialogue(npc.id, position, 'pl');
    expect(started.node).toMatchObject({
      id: 'welcome',
      text: 'Witaj.',
      choices: [
        { id: 'ask', label: 'Zapytaj' },
        { id: 'shop', label: 'Towary' },
      ],
    });

    const next = await service.chooseDialogue(npc.id, 'welcome', 'ask', position, 'en');
    expect(next).toEqual({
      type: 'NODE',
      dialogue: {
        npc: { id: npc.id, key: npc.key, name: npc.name },
        node: {
          id: 'answer',
          text: 'Answer.',
          choices: [{ id: 'leave', label: 'Goodbye' }],
        },
      },
    });
  });

  it('returns an explicit merchant action for the selected choice', async () => {
    const result = await createService().chooseDialogue(
      npc.id,
      'welcome',
      'shop',
      { mapId: 'map-a', x: 10, y: 10 },
      'pl',
    );
    expect(result).toEqual({
      type: 'ACTION',
      action: { type: 'OPEN_MERCHANT', npcId: npc.id },
    });
  });

  it('rejects distant players and invalid conversation state', async () => {
    const service = createService();
    await expect(
      service.startDialogue(npc.id, { mapId: 'map-a', x: 13, y: 10 }, 'pl'),
    ).rejects.toMatchObject({ code: GAME_ERROR_CODES.NPC_NOT_AVAILABLE });
    await expect(
      service.chooseDialogue(npc.id, 'welcome', 'unknown', { mapId: 'map-a', x: 10, y: 10 }, 'pl'),
    ).rejects.toMatchObject({
      code: GAME_ERROR_CODES.NPC_DIALOGUE_STATE_INVALID,
    } satisfies Partial<GameError>);
  });
});
