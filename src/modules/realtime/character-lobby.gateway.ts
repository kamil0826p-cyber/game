import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { z, ZodError } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, SocketAck, SocketErrorPayload, WorldSpawnPayload } from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { SessionLifecycleService, type CharacterLobbySummary } from './session-lifecycle.service.js';

const requestId = z.string().min(1).max(64);
const characterListSchema = z.object({ requestId }).strict();
const characterSelectSchema = z.object({ requestId, characterId: z.string().uuid() }).strict();
const characterOutfitSchema = z.object({
  requestId,
  characterId: z.string().uuid(),
  outfitKey: z.string().trim().min(1).max(64).regex(/^[a-z0-9-]+$/),
}).strict();

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class CharacterLobbyGateway {
  private readonly logger = new Logger(CharacterLobbyGateway.name);

  constructor(
    private readonly lifecycle: SessionLifecycleService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('character:list')
  async list(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CharacterLobbySummary[]>> {
    try {
      characterListSchema.parse(raw);
      return { ok: true, data: await this.lifecycle.listCharacters(client) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('character:select')
  async select(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<WorldSpawnPayload>> {
    try {
      const payload = characterSelectSchema.parse(raw);
      return { ok: true, data: await this.lifecycle.selectCharacter(client, payload.characterId) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('character:outfit')
  async outfit(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<WorldSpawnPayload>> {
    try {
      const payload = characterOutfitSchema.parse(raw);
      return {
        ok: true,
        data: await this.lifecycle.changeOutfit(client, payload.characterId, payload.outfitKey),
      };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    if (error instanceof ZodError) {
      return {
        code: GAME_ERROR_CODES.INVALID_PAYLOAD,
        message: this.localization.translate('errors.payload.invalid', client.data.locale),
      };
    }
    if (error instanceof GameError) {
      return {
        code: error.code,
        message: this.localization.translate(error.messageKey, client.data.locale),
        details: error.details,
      };
    }
    this.logger.error('Character lobby request failed.', error instanceof Error ? error.stack : undefined);
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', client.data.locale),
    };
  }
}
