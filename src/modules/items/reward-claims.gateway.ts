import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { z, ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type {
  GameSocket,
  SocketAck,
  SocketErrorPayload,
} from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import type {
  RewardClaimMutationResult,
  RewardClaimsSnapshot,
} from './reward-claims.contracts.js';
import { RewardClaimsService } from './reward-claims.service.js';

const requestId = z.string().trim().min(1).max(96);
const claimsRequestSchema = z.object({ requestId }).strict();
const claimOneSchema = z
  .object({ requestId, claimId: z.string().uuid() })
  .strict();

type ClaimsRequestPayload = z.infer<typeof claimsRequestSchema>;

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class RewardClaimsGateway {
  private readonly logger = new Logger(RewardClaimsGateway.name);

  constructor(
    private readonly claims: RewardClaimsService,
    private readonly worldState: WorldStateService,
    private readonly movementCoordinator: MovementCoordinatorService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('claims:get')
  get(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<RewardClaimsSnapshot>> {
    return this.handle(client, claimsRequestSchema, raw, (session) =>
      this.claims.getSnapshot(session.userId, session.characterId),
    );
  }

  @SubscribeMessage('claims:claim')
  claim(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<RewardClaimMutationResult>> {
    return this.handle(
      client,
      claimOneSchema,
      raw,
      (session, payload) =>
        this.claims.claimOne(
          session.userId,
          session.characterId,
          payload.claimId,
          payload.requestId,
        ),
      true,
    );
  }

  @SubscribeMessage('claims:claimAll')
  claimAll(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<RewardClaimMutationResult>> {
    return this.handle(
      client,
      claimsRequestSchema,
      raw,
      (session, payload) =>
        this.claims.claimAll(
          session.userId,
          session.characterId,
          payload.requestId,
        ),
      true,
    );
  }

  private async handle<TPayload extends ClaimsRequestPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => Promise<TResult>,
    requiresIdle = false,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.worldState.getBySocketId(client.id);
      if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }
      if (requiresIdle && session.combatState !== 'IDLE') {
        throw new GameError(GAME_ERROR_CODES.COMBAT_FORBIDDEN, 'errors.combat.forbidden');
      }
      const data = await this.movementCoordinator.runSerialized(session, () =>
        operation(session, payload),
      );
      return { ok: true, data };
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
    this.logger.error(
      'Unhandled reward claims gateway error.',
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
