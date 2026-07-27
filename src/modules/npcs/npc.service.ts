import { Injectable } from '@nestjs/common';
import type { NpcStatePayload } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';

interface NpcDialogue {
  type?: unknown;
  interactionRadius?: unknown;
  merchant?: { interactionRadius?: unknown };
}

@Injectable()
export class NpcService {
  constructor(private readonly prisma: PrismaService) {}

  async getMapNpcs(mapId: string): Promise<NpcStatePayload[]> {
    const records = await this.prisma.npcDefinition.findMany({
      where: { mapId },
      orderBy: [{ y: 'asc' }, { x: 'asc' }, { key: 'asc' }],
    });

    return records.map((npc) => {
      const dialogue = npc.dialogue as NpcDialogue | null;
      const interactionType = dialogue?.type === 'MERCHANT' || dialogue?.type === 'QUEST'
        ? dialogue.type
        : 'DIALOGUE';
      const configuredRadius = interactionType === 'MERCHANT'
        ? dialogue?.merchant?.interactionRadius
        : dialogue?.interactionRadius;
      const interactionRadius = typeof configuredRadius === 'number' && Number.isFinite(configuredRadius)
        ? Math.max(0, Math.trunc(configuredRadius))
        : 1;

      return {
        id: npc.id,
        key: npc.key,
        name: npc.name,
        mapId: npc.mapId,
        x: npc.x,
        y: npc.y,
        outfitKey: npc.outfitKey,
        interactionType,
        interactionRadius,
      };
    });
  }
}
