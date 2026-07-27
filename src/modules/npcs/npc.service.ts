import { Injectable } from '@nestjs/common';
import type { NpcStatePayload } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';

interface NpcDialogue {
  type?: unknown;
  interactionRadius?: unknown;
  merchant?: { interactionRadius?: unknown };
}

const tileKey = (x: number, y: number): string => `${x},${y}`;

@Injectable()
export class NpcService {
  private readonly mapNpcCache = new Map<string, Promise<readonly NpcStatePayload[]>>();
  private readonly occupiedTileCache = new Map<string, Promise<ReadonlySet<string>>>();

  constructor(private readonly prisma: PrismaService) {}

  async getMapNpcs(mapId: string): Promise<NpcStatePayload[]> {
    let loading = this.mapNpcCache.get(mapId);
    if (!loading) {
      loading = this.loadMapNpcs(mapId);
      this.mapNpcCache.set(mapId, loading);
    }
    return [...(await loading)];
  }

  async getOccupiedTiles(mapId: string): Promise<ReadonlySet<string>> {
    let loading = this.occupiedTileCache.get(mapId);
    if (!loading) {
      loading = this.getMapNpcs(mapId).then(
        (npcs) => new Set(npcs.map((npc) => tileKey(npc.x, npc.y))),
      );
      this.occupiedTileCache.set(mapId, loading);
    }
    return loading;
  }

  async isTileOccupied(mapId: string, x: number, y: number): Promise<boolean> {
    return (await this.getOccupiedTiles(mapId)).has(tileKey(x, y));
  }

  clearMapCache(mapId?: string): void {
    if (mapId) {
      this.mapNpcCache.delete(mapId);
      this.occupiedTileCache.delete(mapId);
      return;
    }
    this.mapNpcCache.clear();
    this.occupiedTileCache.clear();
  }

  private async loadMapNpcs(mapId: string): Promise<readonly NpcStatePayload[]> {
    const records = await this.prisma.npcDefinition.findMany({
      where: { mapId },
      orderBy: [{ y: 'asc' }, { x: 'asc' }, { key: 'asc' }],
    });

    return records.map((npc) => {
      const dialogue = npc.dialogue as unknown as NpcDialogue | null;
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
