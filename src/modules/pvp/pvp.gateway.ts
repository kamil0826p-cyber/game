import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type {
  PvpNormalizationPreviewResult,
  PvpReplayResult,
  PvpReportResult,
} from '../../contracts/pvp.events.js';
import {
  pvpBountyActionSchema,
  pvpBountyCreateSchema,
  pvpEngageSchema,
  pvpGetSchema,
  pvpNormalizationPreviewSchema,
  pvpRedeemSchema,
  pvpReplayGetSchema,
  pvpReportSchema,
  pvpSetOptInSchema,
} from '../../contracts/pvp.schemas.js';
import type { CombatSnapshot, GameSocket, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { PvpCombatIntegrationService } from '../combat/pvp-combat.integration.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { PvpPolicyViolationError, PvpService, type PvpBountyView, type PvpOverview } from './pvp.service.js';

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class PvpGateway {
  private readonly logger = new Logger(PvpGateway.name);

  constructor(
    private readonly pvp: PvpService,
    private readonly integration: PvpCombatIntegrationService,
    private readonly world: WorldStateService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('pvp:get')
  get(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<PvpOverview>> {
    return this.handle(client, pvpGetSchema, raw, (session) =>
      this.pvp.getOverview(session.userId, session.characterId),
    );
  }

  @SubscribeMessage('pvp:setOptIn')
  setOptIn(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<PvpOverview>> {
    return this.handle(client, pvpSetOptInSchema, raw, (session, payload) =>
      this.pvp.setOptIn(session.userId, session.characterId, payload.optedIn),
    );
  }

  @SubscribeMessage('pvp:redeem')
  redeem(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<PvpOverview>> {
    return this.handle(client, pvpRedeemSchema, raw, (session, payload) =>
      this.pvp.redeemNotoriety({
        userId: session.userId,
        characterId: session.characterId,
        points: payload.points,
        operationId: payload.operationId,
      }),
    );
  }

  @SubscribeMessage('pvp:engage')
  engage(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<CombatSnapshot>> {
    return this.handle(client, pvpEngageSchema, raw, (session, payload) =>
      this.integration.request(session, payload.targetCharacterId, {
        kind: payload.kind,
        ...(payload.modeKey ? { modeKey: payload.modeKey } : {}),
        ...(payload.bountyId ? { bountyId: payload.bountyId } : {}),
        ...(payload.normalized !== undefined ? { normalized: payload.normalized } : {}),
      }),
    );
  }

  @SubscribeMessage('pvp:normalizationPreview')
  normalizationPreview(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<PvpNormalizationPreviewResult>> {
    return this.handle(client, pvpNormalizationPreviewSchema, raw, (session, payload) =>
      this.pvp.getNormalizationPreview(
        session.userId,
        session.characterId,
        payload.modeKey,
        payload.level,
        payload.stats,
      ),
    );
  }

  @SubscribeMessage('pvp:bountyCreate')
  createBounty(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<PvpBountyView>> {
    return this.handle(client, pvpBountyCreateSchema, raw, (session, payload) =>
      this.pvp.createBounty({
        userId: session.userId,
        creatorCharacterId: session.characterId,
        targetCharacterId: payload.targetCharacterId,
        amountSilver: payload.amountSilver,
        durationMs: payload.durationMs,
        operationId: payload.operationId,
      }),
    );
  }

  @SubscribeMessage('pvp:bountyAccept')
  acceptBounty(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<PvpBountyView>> {
    return this.handle(client, pvpBountyActionSchema, raw, (session, payload) =>
      this.pvp.acceptBounty(session.userId, session.characterId, payload.bountyId),
    );
  }

  @SubscribeMessage('pvp:bountyCancel')
  cancelBounty(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<PvpBountyView>> {
    return this.handle(client, pvpBountyActionSchema, raw, (session, payload) =>
      this.pvp.cancelBounty(session.userId, session.characterId, payload.bountyId),
    );
  }

  @SubscribeMessage('pvp:replayGet')
  getReplay(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<PvpReplayResult>> {
    return this.handle(client, pvpReplayGetSchema, raw, (session, payload) =>
      this.pvp.getReplay(session.userId, session.characterId, payload.combatId),
    );
  }

  @SubscribeMessage('pvp:report')
  report(@ConnectedSocket() client: GameSocket, @MessageBody() raw: unknown): Promise<SocketAck<PvpReportResult>> {
    return this.handle(client, pvpReportSchema, raw, (session, payload) =>
      this.pvp.reportCombat({
        userId: session.userId,
        characterId: session.characterId,
        combatId: payload.combatId,
        category: payload.category,
        operationId: payload.operationId,
      }),
    );
  }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => Promise<TResult> | TResult,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.requireSession(client);
      return { ok: true, data: await operation(session, payload) };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private requireSession(client: GameSocket): PlayerSession {
    const session = this.world.getBySocketId(client.id);
    if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    return session;
  }

  private toSocketError(error: unknown, client: GameSocket): SocketErrorPayload {
    const locale = client.data.locale ?? 'en';
    if (error instanceof GameError) {
      return {
        code: error.code,
        message: this.localization.translate(error.messageKey, locale),
        ...(error.details ? { details: error.details } : {}),
      };
    }
    if (error instanceof PvpPolicyViolationError) {
      return {
        code: GAME_ERROR_CODES.COMBAT_FORBIDDEN,
        message: this.localization.translate('errors.combat.forbidden', locale),
        details: { pvpReason: error.reason },
      };
    }
    if (error instanceof ZodError) {
      return {
        code: GAME_ERROR_CODES.INVALID_PAYLOAD,
        message: this.localization.translate('errors.payload.invalid', locale),
        details: { issues: error.issues },
      };
    }
    const message = error instanceof Error ? error.message : '';
    if (
      message === 'PVP_BOUNTY_INSUFFICIENT_SILVER' ||
      message === 'PVP_REDEMPTION_INSUFFICIENT_SILVER'
    ) {
      return {
        code: GAME_ERROR_CODES.INSUFFICIENT_SILVER,
        message: this.localization.translate('errors.items.insufficientSilver', locale),
      };
    }
    if (message.startsWith('PVP_')) {
      return {
        code: GAME_ERROR_CODES.COMBAT_FORBIDDEN,
        message: this.localization.translate('errors.combat.forbidden', locale),
        details: { pvpReason: message },
      };
    }
    this.logger.error('Unhandled PvP gateway error.', error instanceof Error ? error.stack : undefined);
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
