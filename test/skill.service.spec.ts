import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../src/database/prisma.service.js';
import { SkillService } from '../src/modules/skills/skill.service.js';

interface FakeSkill {
  rank: number;
  cooldownTurnsRemaining: number;
  skillDefinition: { key: string };
}

const createHarness = (
  character: { class: 'MAGE' | 'WARRIOR' | 'ARCHER'; level: number } | undefined,
) => {
  const learned: FakeSkill[] = [];
  const definitionByKey = new Map([
    ['warrior-shield-bash', { id: 'definition-warrior', requiredClass: 'WARRIOR' }],
    ['warrior-cleave', { id: 'definition-cleave', requiredClass: 'WARRIOR' }],
  ]);
  const transaction = {
    $queryRaw: vi.fn(async () => [{ id: 'character-a' }]),
    character: {
      findFirst: vi.fn(async () => (character ? { ...character, skills: [...learned] } : null)),
    },
    skillDefinition: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        definitionByKey.get(where.key),
      ),
    },
    characterSkill: {
      create: vi.fn(async ({ data }: { data: { skillDefinitionId: string } }) => {
        const key = [...definitionByKey].find(
          ([, definition]) => definition.id === data.skillDefinitionId,
        )?.[0];
        if (key) {
          learned.push({
            rank: 1,
            cooldownTurnsRemaining: 0,
            skillDefinition: { key },
          });
        }
      }),
    },
  };
  const prisma = {
    $transaction: vi.fn(async (operation: (tx: typeof transaction) => Promise<void>) =>
      operation(transaction),
    ),
    character: {
      findFirst: vi.fn(async () => (character ? { ...character, skills: [...learned] } : null)),
    },
  } as unknown as PrismaService;

  return {
    service: new SkillService(prisma),
    transaction,
  };
};

describe('SkillService', () => {
  it('locks the character row and persists an eligible class skill', async () => {
    const { service, transaction } = createHarness({ class: 'WARRIOR', level: 10 });

    const snapshot = await service.unlock('user-a', 'character-a', 'warrior-shield-bash');

    expect(transaction.$queryRaw).toHaveBeenCalledOnce();
    expect(transaction.characterSkill.create).toHaveBeenCalledWith({
      data: {
        characterId: 'character-a',
        skillDefinitionId: 'definition-warrior',
        rank: 1,
        cooldownTurnsRemaining: 0,
      },
    });
    expect(snapshot.points).toMatchObject({ earned: 1, spent: 1, available: 0 });
    expect(snapshot.skills[0]).toMatchObject({
      key: 'warrior-shield-bash',
      rank: 1,
      unlockState: 'UNLOCKED',
    });
  });

  it('rejects skills from another class without touching definitions', async () => {
    const { service, transaction } = createHarness({ class: 'WARRIOR', level: 80 });

    await expect(
      service.unlock('user-a', 'character-a', 'mage-arcane-spark'),
    ).rejects.toMatchObject({ code: 'SKILL_NOT_AVAILABLE' });
    expect(transaction.skillDefinition.findUnique).not.toHaveBeenCalled();
    expect(transaction.characterSkill.create).not.toHaveBeenCalled();
  });

  it('rejects missing prerequisites even when level and points are sufficient', async () => {
    const { service, transaction } = createHarness({ class: 'WARRIOR', level: 20 });

    await expect(service.unlock('user-a', 'character-a', 'warrior-cleave')).rejects.toMatchObject({
      code: 'SKILL_PREREQUISITE_REQUIRED',
      details: { missingSkillKeys: ['warrior-shield-bash'] },
    });
    expect(transaction.characterSkill.create).not.toHaveBeenCalled();
  });

  it('does not reveal or mutate a character not owned by the authenticated user', async () => {
    const { service, transaction } = createHarness(undefined);

    await expect(
      service.unlock('attacker', 'character-a', 'warrior-shield-bash'),
    ).rejects.toMatchObject({ code: 'SESSION_NOT_READY' });
    expect(transaction.characterSkill.create).not.toHaveBeenCalled();
  });
});
