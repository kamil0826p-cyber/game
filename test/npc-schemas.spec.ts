import { describe, expect, it } from 'vitest';
import {
  merchantBuySchema,
  merchantRequestSchema,
  npcDialogueChoiceSchema,
} from '../src/contracts/socket.schemas.js';

const requestId = 'request-1';
const npcId = '11111111-1111-4111-8111-111111111111';

describe('NPC interaction socket schemas', () => {
  it('requires an explicit NPC for every merchant request', () => {
    expect(merchantRequestSchema.parse({ requestId, npcId })).toEqual({ requestId, npcId });
    expect(() => merchantRequestSchema.parse({ requestId })).toThrow();
    expect(() =>
      merchantBuySchema.parse({
        requestId,
        itemKey: 'field-rations',
        quantity: 1,
      }),
    ).toThrow();
  });

  it('accepts a bounded dialogue choice and rejects extra fields', () => {
    expect(
      npcDialogueChoiceSchema.parse({
        requestId,
        npcId,
        nodeId: 'welcome',
        choiceId: 'show-offer',
      }),
    ).toMatchObject({ npcId, nodeId: 'welcome', choiceId: 'show-offer' });
    expect(() =>
      npcDialogueChoiceSchema.parse({
        requestId,
        npcId,
        nodeId: 'welcome',
        choiceId: 'show offer with spaces',
      }),
    ).toThrow();
    expect(() =>
      npcDialogueChoiceSchema.parse({
        requestId,
        npcId,
        nodeId: 'welcome',
        choiceId: 'show-offer',
        injectedAction: 'OPEN_MERCHANT',
      }),
    ).toThrow();
  });
});
