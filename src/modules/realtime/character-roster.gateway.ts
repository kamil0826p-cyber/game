import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ZodError } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, SocketAck, SocketErrorPayload, WorldSpawnPayload } from '../../contracts/socket.events.js';
import {
  selectCharacterSchema,
  updateCharacterOutfitSchema,
  type SelectCharacterPayload,
  type UpdateCharacterOutfitPayload,
} from '../../contracts/socket.schemas.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import type { CharacterRosterEntry, CharacterRosterPayload } from './session-lifecycle.service.js';
import { SessionLifecycleService } from './session-lifecycle.service.js';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class CharacterRosterGateway {
  constructor(
    private readonly lifecycle: SessionLifecycleService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('character:list')
  async list(@ConnectedSocket() client: GameSocket): Promise<SocketAck<CharacterRosterPayload>> {
    try {
      return { ok: true, data: await this.lifecycle.listCharacters(client) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('character:select')
  async select(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() rawPayload: unknown,
  ): Promise<SocketAck<WorldSpawnPayload>> {
    try {
      const payload: SelectCharacterPayload = selectCharacterSchema.parse(rawPayload);
      return { ok: true, data: await this.lifecycle.selectCharacter(client, payload.characterId) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('character:outfit')
  async outfit(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() rawPayload: unknown,
  ): Promise<SocketAck<CharacterRosterEntry>> {
    try {
      const payload: UpdateCharacterOutfitPayload = updateCharacterOutfitSchema.parse(rawPayload);
      return {
        ok: true,
        data: await this.lifecycle.updateCharacterOutfit(client, payload.characterId, payload.outfitKey),
      };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) {
      return {
        code: error.code,
        message: this.localization.translate(error.messageKey, locale),
        details: error.details,
      };
    }
    if (error instanceof ZodError) {
      return {
        code: GAME_ERROR_CODES.INVALID_PAYLOAD,
        message: this.localization.translate('errors.payload.invalid', locale),
        details: { issues: error.issues },
      };
    }
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
