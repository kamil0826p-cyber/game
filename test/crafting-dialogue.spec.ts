import { describe, expect, it } from 'vitest';
import { npcDialogueDefinitionSchema } from '../src/modules/npcs/npc-dialogue.js';

const dialogue = (withCrafting: boolean) => ({
  type: 'MERCHANT' as const,
  rootNodeId: 'welcome',
  nodes: {
    welcome: {
      text: { en: 'Welcome', pl: 'Witaj' },
      choices: [
        {
          id: 'open-crafting',
          label: { en: 'Use the forge', pl: 'Skorzystaj z kuźni' },
          action: 'OPEN_CRAFTING' as const,
        },
      ],
    },
  },
  merchant: { itemKeys: ['traveler-sword'], infiniteStock: true },
  ...(withCrafting ? { crafting: { workstationKey: 'quartermaster-forge' } } : {}),
});

describe('crafting NPC dialogue', () => {
  it('accepts OPEN_CRAFTING when the NPC declares a workstation', () => {
    const result = npcDialogueDefinitionSchema.safeParse(dialogue(true));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.crafting?.workstationKey).toBe('quartermaster-forge');
    }
  });

  it('rejects OPEN_CRAFTING without a workstation configuration', () => {
    expect(npcDialogueDefinitionSchema.safeParse(dialogue(false)).success).toBe(false);
  });
});
