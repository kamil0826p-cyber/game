import { describe, expect, it } from 'vitest';
import {
  guildBuyExperienceUpgradeSchema,
  guildChatSchema,
  guildCreateSchema,
  guildDepositSchema,
  guildInviteSchema,
  guildSetRoleSchema,
  guildWithdrawSchema,
} from '../src/contracts/socket.schemas.js';

const requestId = 'guild-test-1';
const characterId = '11111111-1111-4111-8111-111111111111';

describe('guild socket schemas', () => {
  it('accepts a valid create command and rejects unknown fields', () => {
    expect(guildCreateSchema.parse({ requestId, name: 'Straż Północy', tag: 'SP', description: '' })).toEqual({
      requestId,
      name: 'Straż Północy',
      tag: 'SP',
      description: '',
    });
    expect(() => guildCreateSchema.parse({ requestId, name: 'Straż Północy', tag: 'SP', description: '', gold: 1 })).toThrow();
  });

  it('limits guild tags, invitations and roles', () => {
    expect(() => guildCreateSchema.parse({ requestId, name: 'Guild', tag: 'TOOLONG', description: '' })).toThrow();
    expect(() => guildInviteSchema.parse({ requestId, characterName: '' })).toThrow();
    expect(guildSetRoleSchema.parse({ requestId, targetCharacterId: characterId, role: 'OFFICER' }).role).toBe('OFFICER');
    expect(() => guildSetRoleSchema.parse({ requestId, targetCharacterId: characterId, role: 'LEADER' })).toThrow();
  });

  it('validates treasury operations as positive integers and keeps them strict', () => {
    expect(guildDepositSchema.parse({ requestId, amount: 50_000 }).amount).toBe(50_000);
    expect(guildWithdrawSchema.parse({ requestId, amount: 1 }).amount).toBe(1);
    expect(() => guildDepositSchema.parse({ requestId, amount: 0 })).toThrow();
    expect(() => guildWithdrawSchema.parse({ requestId, amount: 1.5 })).toThrow();
    expect(() => guildDepositSchema.parse({ requestId, amount: 2_000_000_001 })).toThrow();
    expect(() => guildDepositSchema.parse({ requestId, amount: 10, currency: 'GOLD' })).toThrow();
    expect(guildBuyExperienceUpgradeSchema.parse({ requestId })).toEqual({ requestId });
  });

  it('keeps guild chat small and strict', () => {
    expect(guildChatSchema.parse({ requestId, text: 'Na smoka!' }).text).toBe('Na smoka!');
    expect(() => guildChatSchema.parse({ requestId, text: 'x'.repeat(161) })).toThrow();
    expect(() => guildChatSchema.parse({ requestId, text: 'ok', channel: 'GLOBAL' })).toThrow();
  });
});
