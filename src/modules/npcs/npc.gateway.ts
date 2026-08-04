import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, NpcDialogueChoiceResult, NpcDialogueSnapshot, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import { npcDialogueChoiceSchema, npcDialogueEndSchema, npcDialogueStartSchema } from '../../contracts/socket.schemas.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import type { CraftingStationSession } from '../items/crafting.contracts.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { NpcService, type NpcDialogueResult } from './npc.service.js';

interface DialogueActionPayload {
  type: string;
  npcId: string;
  workstationKey?: string;
}

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class NpcGateway {
  private readonly logger = new Logger(NpcGateway.name);
  constructor(private readonly npcs: NpcService, private readonly worldState: WorldStateService, private readonly movementCoordinator: MovementCoordinatorService, private readonly localization: LocalizationService) {}

  @SubscribeMessage('npc:dialogue:start')
  startDialogue(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<NpcDialogueSnapshot>> {
    return this.handle(client, npcDialogueStartSchema, raw, async (session, payload) => {
      const dialogue = await this.npcs.startDialogue(payload.npcId, session, client.data.locale ?? 'en');
      client.data.activeNpcDialogue = { npcId: payload.npcId, nodeId: dialogue.node.id };
      client.data.merchantNpcId = undefined;
      client.data.craftingStation = undefined;
      return dialogue;
    });
  }

  @SubscribeMessage('npc:dialogue:choose')
  chooseDialogue(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<NpcDialogueChoiceResult>> {
    return this.handle(client, npcDialogueChoiceSchema, raw, async (session, payload) => {
      const active = client.data.activeNpcDialogue;
      if (!active || active.npcId !== payload.npcId || active.nodeId !== payload.nodeId) throw new GameError(GAME_ERROR_CODES.NPC_DIALOGUE_STATE_INVALID, 'errors.npcs.dialogueStateInvalid');
      const result = await this.npcs.chooseDialogue(payload.npcId, payload.nodeId, payload.choiceId, session, client.data.locale ?? 'en');
      if (result.type === 'NODE') {
        client.data.activeNpcDialogue = { npcId: payload.npcId, nodeId: result.dialogue.node.id };
      } else {
        const action = result.action as DialogueActionPayload;
        client.data.activeNpcDialogue = undefined;
        client.data.merchantNpcId = action.type === 'OPEN_MERCHANT' ? payload.npcId : undefined;
        client.data.craftingStation =
          action.type === 'OPEN_CRAFTING' && action.workstationKey
            ? ({ npcId: payload.npcId, workstationKey: action.workstationKey } satisfies CraftingStationSession)
            : undefined;
      }
      this.publishQuestReward(client, session, result);
      return result;
    });
  }

  @SubscribeMessage('npc:dialogue:end')
  endDialogue(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<{ closed: boolean }>> {
    return this.handle(client, npcDialogueEndSchema, raw, async (_session, payload) => {
      const closed = client.data.activeNpcDialogue?.npcId === payload.npcId;
      if (closed) client.data.activeNpcDialogue = undefined;
      return { closed };
    });
  }

  private publishQuestReward(client: GameSocket, session: PlayerSession, result: NpcDialogueResult): void {
    const update = result.questUpdate;
    if (!update?.completed || !update.reward || !update.character) return;
    if (update.reward.gold > 0) client.emit('character:currencyUpdated', { characterId: session.characterId, currency: 'GOLD', amount: update.reward.gold, balance: update.character.gold });
    if (update.reward.silver > 0) client.emit('character:currencyUpdated', { characterId: session.characterId, currency: 'SILVER', amount: update.reward.silver, balance: update.character.silver });
    const locale = client.data.locale ?? 'en';
    client.emit('notification', { code: 'QUEST_REWARDED', message: locale === 'pl' ? `Zadanie ukończone: +${update.reward.experience} doświadczenia, +${update.reward.gold} złota.` : `Quest completed: +${update.reward.experience} experience, +${update.reward.gold} gold.` });
  }

  private async handle<TPayload, TResult>(client: GameSocket, schema: ZodType<TPayload>, raw: unknown, operation: (session: PlayerSession, payload: TPayload) => Promise<TResult>): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.worldState.getBySocketId(client.id);
      if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      return { ok: true, data: await this.movementCoordinator.runSerialized(session, () => operation(session, payload)) };
    } catch (error) { return { ok: false, error: this.toSocketError(error, client) }; }
  }
  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) return { code: error.code, message: this.localization.translate(error.messageKey, locale), details: error.details };
    if (error instanceof ZodError) return { code: GAME_ERROR_CODES.INVALID_PAYLOAD, message: this.localization.translate('errors.payload.invalid', locale), details: { issues: error.issues } };
    this.logger.error('Unhandled NPC gateway error.', error instanceof Error ? error.stack : undefined);
    return { code: GAME_ERROR_CODES.INTERNAL_ERROR, message: this.localization.translate('errors.internal', locale) };
  }
}
