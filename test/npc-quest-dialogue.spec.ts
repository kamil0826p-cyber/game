import { describe, expect, it } from 'vitest';
import { parseNpcDialogueDefinition } from '../src/modules/npcs/npc-dialogue.js';

describe('quest NPC dialogue definition', () => {
  it('accepts state-specific and stage-specific roots with quest actions', () => {
    const definition = parseNpcDialogueDefinition({
      type: 'QUEST', rootNodeId: 'offer',
      quest: {
        questKey: 'rabbit-fur-for-mira',
        rootNodes: { notStarted: 'offer', active: 'active', ready: 'ready', rewarded: 'done' },
        activeStageNodes: { '0': 'visit-hunter', '1': 'hunt-rabbits', '2': 'active' },
      },
      nodes: {
        offer: { text: 'Help me.', choices: [{ id: 'accept', label: 'Yes', questAction: { type: 'ACCEPT', questKey: 'rabbit-fur-for-mira', successNodeId: 'visit-hunter' } }] },
        'visit-hunter': { text: 'Talk to the hunter.', choices: [{ id: 'close', label: 'I will go.', action: 'CLOSE' }] },
        'hunt-rabbits': { text: 'Now defeat the rabbits.', choices: [{ id: 'close', label: 'I will hunt them.', action: 'CLOSE' }] },
        active: { text: 'Return when ready.', choices: [{ id: 'check', label: 'I am back', questAction: { type: 'TURN_IN', questKey: 'rabbit-fur-for-mira', successNodeId: 'done', incompleteNodeId: 'active' } }] },
        ready: { text: 'You have done everything.', choices: [{ id: 'finish', label: 'Finish', questAction: { type: 'TURN_IN', questKey: 'rabbit-fur-for-mira', successNodeId: 'done' } }] },
        done: { text: 'Thank you.', choices: [{ id: 'close', label: 'Bye', action: 'CLOSE' }] },
      },
    });
    expect(definition?.quest?.rootNodes.ready).toBe('ready');
    expect(definition?.quest?.activeStageNodes?.['1']).toBe('hunt-rabbits');
  });
  it('rejects quest actions targeting another quest', () => {
    expect(parseNpcDialogueDefinition({ type: 'QUEST', rootNodeId: 'offer', quest: { questKey: 'quest-a', rootNodes: { notStarted: 'offer', active: 'offer', ready: 'offer', rewarded: 'offer' } }, nodes: { offer: { text: 'Help.', choices: [{ id: 'accept', label: 'Yes', questAction: { type: 'ACCEPT', questKey: 'quest-b', successNodeId: 'offer' } }] } } })).toBeUndefined();
  });
  it('rejects stage roots pointing to missing dialogue nodes', () => {
    expect(parseNpcDialogueDefinition({
      type: 'QUEST', rootNodeId: 'offer',
      quest: { questKey: 'quest-a', rootNodes: { notStarted: 'offer', active: 'offer', ready: 'offer', rewarded: 'offer' }, activeStageNodes: { '1': 'missing' } },
      nodes: { offer: { text: 'Help.', choices: [] } },
    })).toBeUndefined();
  });
});
