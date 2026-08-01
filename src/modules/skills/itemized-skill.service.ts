import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { applyEquippedRelicsToLoadout, parseItemDefinitionMetadata, readItemInstanceSnapshot } from '../items/itemization.rules.js';
import { SkillService } from './skill.service.js';
import type { SkillCombatLoadout } from './skill.buildcraft.types.js';

@Injectable()
export class ItemizedSkillService extends SkillService {
  constructor(private readonly database: PrismaService) {
    super(database);
  }

  override async getCombatLoadout(
    userId: string,
    characterId: string,
  ): Promise<SkillCombatLoadout> {
    const loadout = await super.getCombatLoadout(userId, characterId);
    const items = await this.database.inventoryItem.findMany({
      where: {
        characterId,
        equippedSlot: { not: null },
        character: { userId },
      },
      include: { itemDefinition: true },
      orderBy: { equippedSlot: 'asc' },
    });
    const snapshots = items.map((item) => {
      const metadata = parseItemDefinitionMetadata(item.itemDefinition.metadata);
      return readItemInstanceSnapshot({
        instanceData: item.instanceData,
        definitionKey: item.itemDefinition.key,
        metadata,
      });
    });
    return applyEquippedRelicsToLoadout(loadout, snapshots);
  }
}
