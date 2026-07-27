import { describe, expect, it } from 'vitest';
import { parseAddCurrencyArguments } from '../src/modules/admin/add-currency.admin-command.js';
import { parseAdminCommand } from '../src/modules/admin/admin-command.parser.js';
import { AdminCommandError } from '../src/modules/admin/admin-command.types.js';

describe('admin command parser', () => {
  it('parses a command and preserves arguments', () => {
    expect(parseAdminCommand('/add Sir Test silver 25')).toEqual({ name: 'add', rawArguments: 'Sir Test silver 25' });
  });

  it('rejects malformed command names', () => {
    expect(() => parseAdminCommand('/123')).toThrow(AdminCommandError);
  });
});

describe('/add currency arguments', () => {
  it('parses silver and multi-word character names', () => {
    expect(parseAddCurrencyArguments('Sir Test silver 25')).toEqual({ characterName: 'Sir Test', currency: 'SILVER', amount: 25 });
  });

  it('parses gold case-insensitively', () => {
    expect(parseAddCurrencyArguments('Mage GOLD 9')).toEqual({ characterName: 'Mage', currency: 'GOLD', amount: 9 });
  });

  it.each(['Mage silver 0', 'Mage silver -1', 'Mage copper 1', 'Mage silver 1.5', 'Mage silver 1000000001'])('rejects unsafe input: %s', (input) => {
    expect(() => parseAddCurrencyArguments(input)).toThrow(AdminCommandError);
  });
});
