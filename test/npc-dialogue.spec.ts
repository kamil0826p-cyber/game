import { describe, expect, it } from 'vitest';
import {
  localizeDialogueText,
  npcDialogueDefinitionSchema,
  parseNpcDialogueDefinition,
} from '../src/modules/npcs/npc-dialogue.js';

const validDialogue = {
  type: 'MERCHANT',
  interactionRadius: 2,
  rootNodeId: 'welcome',
  nodes: {
    welcome: {
      text: { pl: 'Witaj.', en: 'Welcome.' },
      choices: [
        { id: 'ask', label: { pl: 'Zapytaj', en: 'Ask' }, nextNodeId: 'details' },
        { id: 'shop', label: { pl: 'Pokaż towary', en: 'Show wares' }, action: 'OPEN_MERCHANT' },
      ],
    },
    details: {
      text: 'A longer answer.',
      choices: [{ id: 'leave', label: 'Goodbye', action: 'CLOSE' }],
    },
  },
  merchant: { itemKeys: ['field-rations'], infiniteStock: true },
} as const;

describe('NPC dialogue definition', () => {
  it('accepts branching nodes and localized text', () => {
    const dialogue = npcDialogueDefinitionSchema.parse(validDialogue);
    expect(dialogue.nodes.welcome.choices[0]?.nextNodeId).toBe('details');
    expect(localizeDialogueText(dialogue.nodes.welcome.text, 'pl')).toBe('Witaj.');
    expect(localizeDialogueText(dialogue.nodes.welcome.text, 'en')).toBe('Welcome.');
  });

  it('upgrades the previous merchant format without losing its offer', () => {
    const dialogue = parseNpcDialogueDefinition({
      type: 'MERCHANT',
      merchant: {
        itemKeys: ['field-rations', 'minor-health-potion'],
        interactionRadius: 2,
        infiniteStock: true,
      },
    });

    expect(dialogue).toMatchObject({
      type: 'MERCHANT',
      interactionRadius: 2,
      rootNodeId: 'welcome',
      merchant: {
        itemKeys: ['field-rations', 'minor-health-potion'],
        infiniteStock: true,
      },
    });
    expect(dialogue?.nodes.welcome.choices).toEqual([
      expect.objectContaining({ id: 'show-offer', action: 'OPEN_MERCHANT' }),
      expect.objectContaining({ id: 'decline', action: 'CLOSE' }),
    ]);
  });

  it('does not reinterpret malformed dialogue as a legacy merchant', () => {
    expect(
      parseNpcDialogueDefinition({
        type: 'MERCHANT',
        merchant: {
          itemKeys: [],
          interactionRadius: 999,
          infiniteStock: true,
        },
      }),
    ).toBeUndefined();
  });

  it('rejects a dangling branch', () => {
    const invalid = {
      ...validDialogue,
      nodes: {
        ...validDialogue.nodes,
        welcome: {
          ...validDialogue.nodes.welcome,
          choices: [
            {
              id: 'ask',
              label: { pl: 'Zapytaj', en: 'Ask' },
              nextNodeId: 'missing',
            },
          ],
        },
      },
    };
    expect(npcDialogueDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects ambiguous choices and merchant actions without an offer', () => {
    expect(
      npcDialogueDefinitionSchema.safeParse({
        type: 'DIALOGUE',
        rootNodeId: 'root',
        nodes: {
          root: {
            text: 'Hello',
            choices: [
              {
                id: 'invalid',
                label: 'Invalid',
                nextNodeId: 'root',
                action: 'CLOSE',
              },
            ],
          },
        },
      }).success,
    ).toBe(false);
    expect(
      npcDialogueDefinitionSchema.safeParse({
        type: 'DIALOGUE',
        rootNodeId: 'root',
        nodes: {
          root: {
            text: 'Hello',
            choices: [{ id: 'shop', label: 'Shop', action: 'OPEN_MERCHANT' }],
          },
        },
      }).success,
    ).toBe(false);
  });
});
