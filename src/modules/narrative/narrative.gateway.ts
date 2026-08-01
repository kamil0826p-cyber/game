import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { z, ZodError } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { WorldStateService } from '../world/world-state.service.js';
import type { PublicNarrativeView } from './narrative.engine.js';
import { NarrativeService, type NarrativeChoiceMutation } from './narrative.service.js';

const getSchema = z.object({ requestId: z.string().min(1).max(64), questKey: z.string().min(1).max(96) }).strict();
const choiceSchema = getSchema.extend({ operationId: z.string().min(1).max(128), optionKey: z.string().min(1).max(96) }).strict();

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class NarrativeGateway {
  private readonly logger = new Logger(NarrativeGateway.name);
  constructor(
    private readonly narrative: NarrativeService,
    private readonly world: WorldStateService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('narrative:get')
  async getNarrative(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<PublicNarrativeView>> {
    return this.handle(client, async () => {
      const request = getSchema.parse(raw);
      const session = this.requireSession(client);
      return this.narrative.getQuestView(session.characterId, session.realmId, session.mapId, request.questKey);
    });
  }

  @SubscribeMessage('narrative:choose')
  async choose(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<NarrativeChoiceMutation>> {
    return this.handle(client, async () => {
      const request = choiceSchema.parse(raw);
      const session = this.requireSession(client);
      return this.narrative.choose(session, request.questKey, request.operationId, request.optionKey);
    });
  }

  private requireSession(client: GameSocket) {
    const session = this.world.getBySocketId(client.id);
    if (!session?.activeInWorld || client.data.sessionState !== 'IN_WORLD') throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    return session;
  }

  private async handle<T>(client: GameSocket, operation: () => Promise<T>): Promise<SocketAck<T>> {
    try {
      return { ok: true, data: await operation() };
    } catch (error) {
      const locale = client.data.locale ?? 'en';
      if (error instanceof GameError) return { ok: false, error: { code: error.code, message: this.localization.translate(error.messageKey, locale), details: error.details } };
      if (error instanceof ZodError) return { ok: false, error: { code: GAME_ERROR_CODES.INVALID_PAYLOAD, message: this.localization.translate('errors.payload.invalid', locale), details: { issues: error.issues } };
      this.logger.error('Unhandled narrative gateway error.', error instanceof Error ? error.stack : undefined);
      const payload: SocketErrorPayload = { code: GAME_ERROR_CODES.INTERNAL_ERROR, message: this.localization.translate('errors.internal', locale) };
      return { ok: false, error: payload };
    }
  }
}
