import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { GAME_ERROR_CODES } from '../src/common/errors/game.error.js';
import type { InventorySnapshot } from '../src/contracts/socket.events.js';
import { ItemGateway } from '../src/modules/items/item.gateway.js';

const itemId = '00000000-0000-0000-0000-000000000001';
const payload = { requestId: 'equipment-test', itemId };
const inventory: InventorySnapshot = { capacity: 40, silver: 0, items: [] };

function createGateway(input: { combatState: 'IDLE' | 'IN_BATTLE'; occupied: boolean }) {
  const session = {
    userId: 'user-1',
    characterId: 'character-1',
    activeInWorld: true,
    combatState: input.combatState,
  };
  const items = {
    equip: vi.fn().mockResolvedValue(inventory),
    unequip: vi.fn().mockResolvedValue(inventory),
  };
  const world = { getBySocketId: vi.fn().mockReturnValue(session) };
  const movement = {
    runSerialized: vi.fn(async (_session: unknown, operation: () => Promise<unknown>) => operation()),
  };
  const occupancy = { isOccupied: vi.fn().mockReturnValue(input.occupied) };
  const localization = { translate: vi.fn((key: string) => key) };
  const gateway = new ItemGateway(
    items as never,
    world as never,
    movement as never,
    occupancy as never,
    localization as never,
  );
  const client = {
    id: 'socket-1',
    data: { sessionState: 'IN_WORLD', locale: 'en' },
  };
  return { gateway, items, client };
}

describe('equipment resource and combat safety', () => {
  it('keeps absolute health and energy when equipment changes maximum resources', () => {
    const canonical = readFileSync(
      fileURLToPath(new URL('../src/modules/items/canonical-item.service.ts', import.meta.url)),
      'utf8',
    );
    const itemized = readFileSync(
      fileURLToPath(new URL('../src/modules/items/itemized-item.service.ts', import.meta.url)),
      'utf8',
    );

    expect(canonical.match(/preserveAbsoluteResources: true/g)).toHaveLength(4);
    expect(itemized).toContain('const resourceState = { hp: item.character.hp, energy: item.character.energy }');
    expect(itemized).toContain('await this.restoreAbsoluteResources(');
    expect(itemized).toContain('const nextHp = Math.min(character.maxHp, Math.max(0, hp));');
    expect(itemized).toContain('const nextEnergy = Math.min(character.maxEnergy, Math.max(0, energy));');
  });

  it('blocks equipping and unequipping during an active fight', async () => {
    const { gateway, items, client } = createGateway({
      combatState: 'IN_BATTLE',
      occupied: true,
    });

    const equip = await gateway.equip(client as never, payload);
    const unequip = await gateway.unequip(client as never, payload);

    expect(equip).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: GAME_ERROR_CODES.COMBAT_ACTION_INVALID,
        details: { reason: 'EQUIPMENT_LOCKED_DURING_COMBAT' },
      }),
    });
    expect(unequip).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: GAME_ERROR_CODES.COMBAT_ACTION_INVALID,
        details: { reason: 'EQUIPMENT_LOCKED_DURING_COMBAT' },
      }),
    });
    expect(items.equip).not.toHaveBeenCalled();
    expect(items.unequip).not.toHaveBeenCalled();
  });

  it('blocks equipment changes while a PvP request owns the character', async () => {
    const { gateway, items, client } = createGateway({
      combatState: 'IDLE',
      occupied: true,
    });

    const response = await gateway.equip(client as never, payload);

    expect(response).toEqual({
      ok: false,
      error: expect.objectContaining({
        code: GAME_ERROR_CODES.COMBAT_ACTION_INVALID,
        details: { reason: 'EQUIPMENT_LOCKED_DURING_COMBAT' },
      }),
    });
    expect(items.equip).not.toHaveBeenCalled();
  });

  it('allows equipment changes when the character is idle and unoccupied', async () => {
    const { gateway, items, client } = createGateway({
      combatState: 'IDLE',
      occupied: false,
    });

    await expect(gateway.equip(client as never, payload)).resolves.toEqual({
      ok: true,
      data: inventory,
    });
    expect(items.equip).toHaveBeenCalledWith('user-1', 'character-1', itemId, undefined);
  });

  it('wires one shared occupancy service into combat and item modules', () => {
    const combatModule = readFileSync(
      fileURLToPath(new URL('../src/modules/combat/combat.module.ts', import.meta.url)),
      'utf8',
    );
    const itemModule = readFileSync(
      fileURLToPath(new URL('../src/modules/items/item.module.ts', import.meta.url)),
      'utf8',
    );
    const itemGateway = readFileSync(
      fileURLToPath(new URL('../src/modules/items/item.gateway.ts', import.meta.url)),
      'utf8',
    );

    expect(combatModule).toContain('CombatOccupancyModule');
    expect(itemModule).toContain('CombatOccupancyModule');
    expect(itemGateway).toContain('this.combatOccupancy.isOccupied(session.characterId)');
  });
});
