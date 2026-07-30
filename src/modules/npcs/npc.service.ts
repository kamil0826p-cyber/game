import { Injectable, Optional } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { ACTOR_INTERACTION_RADIUS, isActorWithinInteractionRange } from '../../common/rules/actor-interaction.js';
import type { NpcDialogueChoiceResult, NpcDialogueSnapshot, NpcStatePayload } from '../../contracts/socket.events.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { SupportedLocale } from '../../i18n/localization.service.js';
import { QuestService, type QuestMutationResult } from '../quests/quest.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { localizeDialogueText, parseNpcDialogueDefinition, type NpcDialogueDefinition } from './npc-dialogue.js';

interface NpcDialogue { type?: unknown; }
interface NpcInteractionPosition { characterId?: string; userId?: string; mapId: string; x: number; y: number; }
export type NpcDialogueResult = NpcDialogueChoiceResult & { questUpdate?: QuestMutationResult };
const tileKey = (x: number, y: number): string => `${x},${y}`;

@Injectable()
export class NpcService {
  private readonly mapNpcCache = new Map<string, Promise<readonly NpcStatePayload[]>>();
  private readonly occupiedTileCache = new Map<string, Promise<ReadonlySet<string>>>();
  constructor(private readonly prisma: PrismaService, @Optional() private readonly quests?: QuestService) {}
  async getMapNpcs(mapId: string): Promise<NpcStatePayload[]> { let loading = this.mapNpcCache.get(mapId); if (!loading) { loading = this.loadMapNpcs(mapId); this.mapNpcCache.set(mapId, loading); } return [...(await loading)]; }
  async getOccupiedTiles(mapId: string): Promise<ReadonlySet<string>> { let loading = this.occupiedTileCache.get(mapId); if (!loading) { loading = this.getMapNpcs(mapId).then((npcs) => new Set(npcs.map((npc) => tileKey(npc.x, npc.y)))); this.occupiedTileCache.set(mapId, loading); } return loading; }
  async isTileOccupied(mapId: string, x: number, y: number): Promise<boolean> { return (await this.getOccupiedTiles(mapId)).has(tileKey(x, y)); }
  clearMapCache(mapId?: string): void { if (mapId) { this.mapNpcCache.delete(mapId); this.occupiedTileCache.delete(mapId); return; } this.mapNpcCache.clear(); this.occupiedTileCache.clear(); }

  async startDialogue(npcId: string, position: NpcInteractionPosition, locale: SupportedLocale): Promise<NpcDialogueSnapshot> {
    const { npc, dialogue } = await this.requireAvailableNpc(npcId, position);
    if (position.characterId && this.quests) await this.quests.recordNpcTalk(position.characterId, npc.key);
    let nodeId = dialogue.rootNodeId;
    if (dialogue.quest) {
      if (!position.characterId || !this.quests) throw new GameError(GAME_ERROR_CODES.QUEST_DEFINITION_INVALID, 'errors.quests.definitionInvalid');
      const context = await this.quests.getDialogueContext(position.characterId, dialogue.quest.questKey);
      if (context.state === 'NOT_STARTED') nodeId = dialogue.quest.rootNodes.notStarted;
      else if (context.state === 'READY') nodeId = dialogue.quest.rootNodes.ready;
      else if (context.state === 'REWARDED') nodeId = dialogue.quest.rootNodes.rewarded;
      else nodeId = context.activeStage === undefined
        ? dialogue.quest.rootNodes.active
        : dialogue.quest.activeStageNodes?.[String(context.activeStage)] ?? dialogue.quest.rootNodes.active;
    }
    return this.toDialogueSnapshot(npc, dialogue, nodeId, locale);
  }

  async chooseDialogue(npcId: string, nodeId: string, choiceId: string, position: NpcInteractionPosition, locale: SupportedLocale): Promise<NpcDialogueResult> {
    const { npc, dialogue } = await this.requireAvailableNpc(npcId, position);
    const node = dialogue.nodes[nodeId]; const choice = node?.choices.find((candidate) => candidate.id === choiceId);
    if (!node || !choice) throw new GameError(GAME_ERROR_CODES.NPC_DIALOGUE_STATE_INVALID, 'errors.npcs.dialogueStateInvalid');
    if (choice.nextNodeId) return { type: 'NODE', dialogue: this.toDialogueSnapshot(npc, dialogue, choice.nextNodeId, locale) };
    if (choice.questAction) {
      if (!position.characterId || !position.userId || !this.quests) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      const session = position as PlayerSession;
      const questUpdate = choice.questAction.type === 'ACCEPT' ? await this.quests.accept(session, choice.questAction.questKey) : await this.quests.turnIn(session, choice.questAction.questKey, locale);
      const targetNodeId = questUpdate.completed ? choice.questAction.successNodeId : choice.questAction.type === 'TURN_IN' ? choice.questAction.incompleteNodeId ?? choice.questAction.successNodeId : choice.questAction.successNodeId;
      return { type: 'NODE', dialogue: this.toDialogueSnapshot(npc, dialogue, targetNodeId, locale), questUpdate };
    }
    return { type: 'ACTION', action: { type: choice.action!, npcId: npc.id } };
  }

  private async loadMapNpcs(mapId: string): Promise<readonly NpcStatePayload[]> {
    const records = await this.prisma.npcDefinition.findMany({ where: { mapId }, orderBy: [{ y: 'asc' }, { x: 'asc' }, { key: 'asc' }] });
    return records.map((npc) => { const dialogue = npc.dialogue as unknown as NpcDialogue | null; const interactionType = dialogue?.type === 'MERCHANT' || dialogue?.type === 'QUEST' ? dialogue.type : 'DIALOGUE'; return { id: npc.id, key: npc.key, name: npc.name, mapId: npc.mapId, x: npc.x, y: npc.y, outfitKey: npc.outfitKey, interactionType, interactionRadius: ACTOR_INTERACTION_RADIUS }; });
  }
  private async requireAvailableNpc(npcId: string, position: NpcInteractionPosition) {
    const npc = await this.prisma.npcDefinition.findUnique({ where: { id: npcId } });
    if (!npc || npc.mapId !== position.mapId) throw new GameError(GAME_ERROR_CODES.NPC_NOT_AVAILABLE, 'errors.npcs.notAvailable');
    const dialogue = parseNpcDialogueDefinition(npc.dialogue);
    if (!dialogue) throw new GameError(GAME_ERROR_CODES.NPC_DIALOGUE_UNAVAILABLE, 'errors.npcs.dialogueUnavailable', { npcId });
    if (!isActorWithinInteractionRange(npc, position)) throw new GameError(GAME_ERROR_CODES.NPC_NOT_AVAILABLE, 'errors.npcs.notAvailable');
    return { npc, dialogue };
  }
  private toDialogueSnapshot(npc: { id: string; key: string; name: string }, dialogue: NpcDialogueDefinition, nodeId: string, locale: SupportedLocale): NpcDialogueSnapshot {
    const node = dialogue.nodes[nodeId]; if (!node) throw new GameError(GAME_ERROR_CODES.NPC_DIALOGUE_UNAVAILABLE, 'errors.npcs.dialogueUnavailable', { npcId: npc.id, nodeId });
    return { npc: { id: npc.id, key: npc.key, name: npc.name }, node: { id: nodeId, text: localizeDialogueText(node.text, locale), choices: node.choices.map((choice) => ({ id: choice.id, label: localizeDialogueText(choice.label, locale) })) } };
  }
}
