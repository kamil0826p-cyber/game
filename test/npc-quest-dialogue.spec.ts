import { describe, expect, it } from 'vitest';
import { parseNpcDialogueDefinition } from '../src/modules/npcs/npc-dialogue.js';

describe('quest NPC dialogue definition', () => {
  it('accepts state-specific roots and quest actions', () => {
    const definition = parseNpcDialogueDefinition({
      type: 'QUEST', rootNodeId: 'offer',
      quest: { questKey: 'rabbit-fur-for-mira', rootNodes: { notStarted: 'offer', active: 'active', ready: 'ready', rewarded: 'done' } },
      nodes: {
        offer: { text: 'Help me.', choices: [{ id: 'accept', label: 'Yes', questAction: { type: 'ACCEPT', questKey: 'rabbit-fur-for-mira', successNodeId: 'active' } }] },
        active: { text: 'Still looking?', choices: [{ id: 'check', label: 'I have them', questAction: { type: 'TURN_IN', questKey: 'rabbit-fur-for-mira', successNodeId: 'done', incompleteNodeId: 'active' } }] },
        ready: { text: 'You have everything.', choices: [{ id: 'finish', label: 'Take them', questAction: { type: 'TURN_IN', questKey: 'rabbit-fur-for-mira', successNodeId: 'done' } }] },
        done: { text: 'Thank you.', choices: [{ id: 'close', label: 'Bye', action: 'CLOSE' }] },
      },
    });
    expect(definition?.quest?.rootNodes.ready).toBe('ready');
  });
  it('rejects quest actions targeting another quest', () => {
    expect(parseNpcDialogueDefinition({ type: 'QUEST', rootNodeId: 'offer', quest: { questKey: 'quest-a', rootNodes: { notStarted: 'offer', active: 'offer', ready: 'offer', rewarded: 'offer' } }, nodes: { offer: { text: 'Help.', choices: [{ id: 'accept', label: 'Yes', questAction: { type: 'ACCEPT', questKey: 'quest-b', successNodeId: 'offer' } }] } } })).toBeUndefined();
  });
});
