import { Logger } from '@nestjs/common';
import { ConnectedSocket, MessageBody, SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import { PlayerPersistenceService } from '../persistence/player-persistence.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import {
  progressionChooseSchema,
  progressionGetSchema,
  progressionRespecSchema,
  type ProgressionChoosePayload,
  type ProgressionGetPayload,
  type ProgressionRespecPayload,
} from './progression.schemas.js';
import { ProgressionService } from './progression.service.js';
import type { ProgressionMutationResult, ProgressionSnapshot } from './progression.types.js';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class ProgressionGateway {
  private readonly logger = new Logger(ProgressionGateway.name);

  constructor(
    private readonly progression: ProgressionService,
    private readonly world: WorldStateService,
    private readonly movement: MovementCoordinatorService,
    private readonly persistence: PlayerPersistenceService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('progression:get')
  get(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ProgressionSnapshot>> {
    return this.handle(client, progressionGetSchema, raw, (session) =>
      this.progression.getSnapshot(session.userId, session.characterId));
  }

  @SubscribeMessage('progression:choose')
  choose(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ProgressionSnapshot>> {
    return this.handle(client, progressionChooseSchema, raw, (session, payload) =>
      this.mutate(session, () => this.progression.choose(
        session.userId,
        session.characterId,
        payload.requestId,
        payload.nodeKey,
      )));
  }

  @SubscribeMessage('progression:respec')
  respec(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ProgressionSnapshot>> {
    return this.handle(client, progressionRespecSchema, raw, (session, payload) =>
      this.mutate(session, () => this.progression.respec(
        session.userId,
        session.characterId,
        payload.requestId,
      )));
  }

  private async mutate(
    session: PlayerSession,
    operation: () => Promise<ProgressionMutationResult>,
  ): Promise<ProgressionSnapshot> {
    return this.movement.quiesce(session, async () => {
      await this.persistence.persistSession(session, 'repair');
      const result = await operation();
      Object.assign(session, result.snapshot.effective, {
        hp: result.hp,
        energy: result.energy,
        silver: result.silver,
      });
      session.stateRevision = result.stateVersion;
      session.persistedRevision = result.stateVersion;
      session.dirty = false;
      return result.snapshot;
    });
  }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => TResult | Promise<TResult>,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.world.getBySocketId(client.id);
      if (!session?.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }
      return { ok: true, data: await operation(session, payload) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) {
      return {
        code: error.code,
        message: this.localization.translate(error.messageKey as never, locale),
        ...(error.details ? { details: error.details } : {}),
      };
    }
    if (error instanceof ZodError) {
      return {
        code: GAME_ERROR_CODES.INVALID_PAYLOAD,
        message: this.localization.translate('errors.payload.invalid', locale),
        details: { issues: error.issues },
      };
    }
    this.logger.error('Unhandled progression gateway error.', error instanceof Error ? error.stack : undefined);
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
