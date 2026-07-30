import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { z, ZodError } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { WorldStateService } from '../world/world-state.service.js';
import { QuestService, type QuestLogSnapshot } from './quest.service.js';

const requestSchema = z.object({ requestId: z.string().min(1).max(64) }).strict();

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class QuestGateway {
  private readonly logger = new Logger(QuestGateway.name);

  constructor(
    private readonly quests: QuestService,
    private readonly world: WorldStateService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('quests:get')
  async getQuests(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<QuestLogSnapshot>> {
    try {
      requestSchema.parse(raw);
      const session = this.world.getBySocketId(client.id);
      if (!session?.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }

      return {
        ok: true,
        data: await this.quests.getLog(
          session.characterId,
          client.data.locale ?? 'en',
          session.mapId,
        ),
      };
    } catch (error) {
      const locale = client.data.locale ?? 'en';
      if (error instanceof GameError) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: this.localization.translate(error.messageKey, locale),
            details: error.details,
          },
        };
      }
      if (error instanceof ZodError) {
        return {
          ok: false,
          error: {
            code: GAME_ERROR_CODES.INVALID_PAYLOAD,
            message: this.localization.translate('errors.payload.invalid', locale),
            details: { issues: error.issues },
          },
        };
      }

      this.logger.error(
        'Unhandled quest gateway error.',
        error instanceof Error ? error.stack : undefined,
      );
      const payload: SocketErrorPayload = {
        code: GAME_ERROR_CODES.INTERNAL_ERROR,
        message: this.localization.translate('errors.internal', locale),
      };
      return { ok: false, error: payload };
    }
  }
}
