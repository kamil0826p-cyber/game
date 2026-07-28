import { Injectable } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { NpcDialogueChoiceResult, NpcDialogueSnapshot, NpcStatePayload } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { SupportedLocale } from '../../i18n/localization.service.js';
import { localizeDialogueText, npcDialogueDefinitionSchema, type NpcDialogueDefinition } from './npc-dialogue.js';

interface NpcDialogue {
  type?: unknown;
  interactionRadius?: unknown;
  merchant?: { interactionRadius?: unknown };
}

interface NpcInteractionPosition { mapId: string; x: number; y: number; }

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

  async startDialogue(npcId: string, position: NpcInteractionPosition, locale: SupportedLocale): Promise<NpcDialogueSnapshot> {
    const { npc, dialogue } = await this.requireAvailableNpc(npcId, position);
    return this.toDialogueSnapshot(npc, dialogue, dialogue.rootNodeId, locale);
  }

  async chooseDialogue(npcId: string, nodeId: string, choiceId: string, position: NpcInteractionPosition, locale: SupportedLocale): Promise<NpcDialogueChoiceResult> {
    const { npc, dialogue } = await this.requireAvailableNpc(npcId, position);
    const node = dialogue.nodes[nodeId];
    const choice = node?.choices.find((candidate) => candidate.id === choiceId);
    if (!node || !choice) throw new GameError(GAME_ERROR_CODES.NPC_DIALOGUE_STATE_INVALID, 'errors.npcs.dialogueStateInvalid');
    if (choice.nextNodeId) return { type: 'NODE', dialogue: this.toDialogueSnapshot(npc, dialogue, choice.nextNodeId, locale) };
    return { type: 'ACTION', action: { type: choice.action!, npcId: npc.id } };
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
      const configuredRadius = dialogue?.interactionRadius ?? (interactionType === 'MERCHANT'
        ? dialogue?.merchant?.interactionRadius
        : undefined);
      const interactionRadius = typeof configuredRadius === 'number' && Number.isFinite(configuredRadius)
        ? Math.min(8, Math.max(0, Math.trunc(configuredRadius)))
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

  private async requireAvailableNpc(npcId: string, position: NpcInteractionPosition) {
    const npc = await this.prisma.npcDefinition.findUnique({ where: { id: npcId } });
    if (!npc || npc.mapId !== position.mapId) throw new GameError(GAME_ERROR_CODES.NPC_NOT_AVAILABLE, 'errors.npcs.notAvailable');
    const parsed = npcDialogueDefinitionSchema.safeParse(npc.dialogue);
    if (!parsed.success) throw new GameError(GAME_ERROR_CODES.NPC_DIALOGUE_UNAVAILABLE, 'errors.npcs.dialogueUnavailable', { npcId });
    const distance = Math.max(Math.abs(npc.x - position.x), Math.abs(npc.y - position.y));
    if (distance > parsed.data.interactionRadius) throw new GameError(GAME_ERROR_CODES.NPC_NOT_AVAILABLE, 'errors.npcs.notAvailable');
    return { npc, dialogue: parsed.data };
  }

  private toDialogueSnapshot(npc: { id: string; key: string; name: string }, dialogue: NpcDialogueDefinition, nodeId: string, locale: SupportedLocale): NpcDialogueSnapshot {
    const node = dialogue.nodes[nodeId];
    if (!node) throw new GameError(GAME_ERROR_CODES.NPC_DIALOGUE_UNAVAILABLE, 'errors.npcs.dialogueUnavailable', { npcId: npc.id, nodeId });
    return {
      npc: { id: npc.id, key: npc.key, name: npc.name },
      node: {
        id: nodeId,
        text: localizeDialogueText(node.text, locale),
        choices: node.choices.map((choice) => ({ id: choice.id, label: localizeDialogueText(choice.label, locale) })),
      },
    };
  }
}
