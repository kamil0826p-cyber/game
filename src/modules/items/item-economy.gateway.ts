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
import { ItemEconomyService } from './item-economy.service.js';

const requestId = z.string().trim().min(1).max(96);
const characterOperation = z.object({ requestId }).strict();
const salvageSchema = z
  .object({ requestId, itemId: z.string().uuid() })
  .strict();
const marketQuerySchema = z
  .object({ requestId, itemKey: z.string().trim().min(1).max(96).optional() })
  .strict();
const marketListSchema = z
  .object({
    requestId,
    itemId: z.string().uuid(),
    quantity: z.number().int().min(1).max(9999),
    priceSilver: z.number().int().min(1).max(2_147_483_647),
  })
  .strict();
const marketActionSchema = z
  .object({ requestId, listingId: z.string().uuid() })
  .strict();
const claimActionSchema = z
  .object({ requestId, claimId: z.string().uuid() })
  .strict();

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class ItemEconomyGateway {
  private readonly logger = new Logger(ItemEconomyGateway.name);

  constructor(
    private readonly economy: ItemEconomyService,
    private readonly worldState: WorldStateService,
    private readonly movementCoordinator: MovementCoordinatorService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('itemization:get')
  get(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<unknown>> {
    return this.handle(client, characterOperation, raw, (session) =>
      this.economy.snapshot(session.userId, session.characterId),
    );
  }

  @SubscribeMessage('itemization:salvage')
  salvage(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<unknown>> {
    return this.handle(client, salvageSchema, raw, (session, payload) =>
      this.economy.salvage(
        session.userId,
        session.characterId,
        payload.itemId,
        payload.requestId,
      ),
    );
  }

  @SubscribeMessage('itemization:market:get')
  market(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<unknown>> {
    return this.handle(client, marketQuerySchema, raw, (_session, payload) =>
      this.economy.market(payload.itemKey),
    );
  }

  @SubscribeMessage('itemization:market:list')
  listMarketItem(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<unknown>> {
    return this.handle(client, marketListSchema, raw, (session, payload) =>
      this.economy.createMarketListing(
        session.userId,
        session.characterId,
        payload.itemId,
        payload.quantity,
        payload.priceSilver,
        payload.requestId,
      ),
    );
  }

  @SubscribeMessage('itemization:market:buy')
  buyMarketItem(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<unknown>> {
    return this.handle(client, marketActionSchema, raw, async (session, payload) => {
      const result = await this.economy.buyMarketListing(
        session.userId,
        session.characterId,
        payload.listingId,
        payload.requestId,
      );
      this.syncSilver(session, result);
      return result;
    });
  }

  @SubscribeMessage('itemization:market:cancel')
  cancelMarketItem(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<unknown>> {
    return this.handle(client, marketActionSchema, raw, async (session, payload) => {
      const result = await this.economy.cancelMarketListing(
        session.userId,
        session.characterId,
        payload.listingId,
        payload.requestId,
      );
      this.syncSilver(session, result);
      return result;
    });
  }

  @SubscribeMessage('itemization:claims:get')
  claims(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<unknown>> {
    return this.handle(client, characterOperation, raw, (session) =>
      this.economy.claims(session.userId, session.characterId),
    );
  }

  @SubscribeMessage('itemization:claims:claim')
  claim(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<unknown>> {
    return this.handle(client, claimActionSchema, raw, async (session, payload) => {
      const result = await this.economy.claim(
        session.userId,
        session.characterId,
        payload.claimId,
        payload.requestId,
      );
      this.syncSilver(session, result);
      return result;
    });
  }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => Promise<TResult>,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.worldState.getBySocketId(client.id);
      if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }
      const data = await this.movementCoordinator.runSerialized(session, () =>
        operation(session, payload),
      );
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private syncSilver(session: PlayerSession, value: unknown): void {
    if (
      value &&
      typeof value === 'object' &&
      'silver' in value &&
      typeof (value as { silver?: unknown }).silver === 'number'
    ) {
      session.silver = (value as { silver: number }).silver;
      session.stateRevision += 1;
      session.dirty = true;
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
    if (this.isUniqueOperationError(error)) {
      return {
        code: GAME_ERROR_CODES.INVALID_PAYLOAD,
        message: this.localization.translate('errors.payload.invalid', locale),
      };
    }
    this.logger.error(
      'Unhandled item economy gateway error.',
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }

  private isUniqueOperationError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }
}
