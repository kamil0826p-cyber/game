import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import { MarketNpcBootstrapService } from '../src/modules/items/market-npc-bootstrap.service.js';
import type { NpcService } from '../src/modules/npcs/npc.service.js';
import { parseNpcDialogueDefinition } from '../src/modules/npcs/npc-dialogue.js';

describe('market NPC access', () => {
  it('accepts OPEN_MARKET only when a market configuration exists', () => {
    const valid = parseNpcDialogueDefinition({
      type: 'MERCHANT',
      rootNodeId: 'welcome',
      nodes: {
        welcome: {
          text: { en: 'Welcome', pl: 'Witaj' },
          choices: [
            {
              id: 'open-market',
              label: { en: 'Market', pl: 'Rynek' },
              action: 'OPEN_MARKET',
            },
          ],
        },
      },
      merchant: { itemKeys: ['traveler-sword'], infiniteStock: true },
      market: { marketKey: 'greenfields-market' },
    });
    const invalid = parseNpcDialogueDefinition({
      type: 'DIALOGUE',
      rootNodeId: 'welcome',
      nodes: {
        welcome: {
          text: 'Welcome',
          choices: [{ id: 'open-market', label: 'Market', action: 'OPEN_MARKET' }],
        },
      },
    });

    expect(valid?.market).toEqual({ marketKey: 'greenfields-market' });
    expect(valid?.nodes.welcome?.choices[0]?.action).toBe('OPEN_MARKET');
    expect(invalid).toBeUndefined();
  });

  it('adds the market choice to Borin without removing merchant or crafting data', async () => {
    const update = vi.fn().mockResolvedValue({});
    const clearMapCache = vi.fn();
    const prisma = {
      npcDefinition: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'npc-1',
            dialogue: {
              type: 'MERCHANT',
              rootNodeId: 'welcome',
              nodes: {
                welcome: {
                  text: { en: 'Welcome', pl: 'Witaj' },
                  choices: [
                    {
                      id: 'show-offer',
                      label: { en: 'Shop', pl: 'Sklep' },
                      action: 'OPEN_MERCHANT',
                    },
                    {
                      id: 'open-crafting',
                      label: { en: 'Forge', pl: 'Kuźnia' },
                      action: 'OPEN_CRAFTING',
                    },
                    { id: 'leave', label: { en: 'Leave', pl: 'Wyjdź' }, action: 'CLOSE' },
                  ],
                },
              },
              merchant: { itemKeys: ['traveler-sword'], infiniteStock: true },
              crafting: { workstationKey: 'quartermaster-forge' },
            },
          },
        ]),
        update,
      },
    } as unknown as PrismaService;
    const service = new MarketNpcBootstrapService(
      prisma,
      { clearMapCache } as unknown as NpcService,
    );

    await service.onApplicationBootstrap();

    const dialogue = update.mock.calls[0]?.[0]?.data.dialogue as Record<string, any>;
    expect(dialogue.merchant).toEqual({ itemKeys: ['traveler-sword'], infiniteStock: true });
    expect(dialogue.crafting).toEqual({ workstationKey: 'quartermaster-forge' });
    expect(dialogue.market).toEqual({ marketKey: 'greenfields-market' });
    expect(dialogue.nodes.welcome.choices).toContainEqual(
      expect.objectContaining({ id: 'open-market', action: 'OPEN_MARKET' }),
    );
    expect(clearMapCache).toHaveBeenCalledOnce();
  });
});
