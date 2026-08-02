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
import {
  ExpeditionService,
  type ExpeditionMutationInput,
  type ExpeditionPrepareInput,
} from './expedition.service.js';
import type {
  ExpeditionCatalogView,
  ExpeditionPublicView,
} from './expedition.view.js';

const emptySchema: ZodType<Record<string, never>> = z.object({}).strict();
const operationId = z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/);
const runMutationSchema: ZodType<ExpeditionMutationInput> = z.object({
  runId: z.string().uuid(),
  operationId,
  expectedRevision: z.number().int().nonnegative(),
}).strict();
const prepareSchema: ZodType<ExpeditionPrepareInput> = z.object({
  operationId,
  definitionKey: z.string().min(1).max(96),
  definitionVersion: z.number().int().positive().optional(),
  difficulty: z.enum(['BASE', 'MASTERED', 'RITUAL']),
  riskProfileKey: z.string().min(1).max(96),
  riskVersion: z.number().int().positive(),
  insurancePurchased: z.boolean(),
  formationKey: z.string().min(1).max(64),
  roles: z.record(
    z.string().uuid(),
    z.object({
      roleKey: z.string().min(1).max(64),
      formation: z.enum(['FRONT', 'BACK']),
    }).strict(),
  ),
}).strict();
const advanceSchema: ZodType<ExpeditionMutationInput & { edgeKey: string }> = z.object({
  runId: z.string().uuid(),
  operationId,
  expectedRevision: z.number().int().nonnegative(),
  edgeKey: z.string().min(1).max(96),
}).strict();
const ritualSchema: ZodType<ExpeditionMutationInput & { choiceKey: string }> = z.object({
  runId: z.string().uuid(),
  operationId,
  expectedRevision: z.number().int().nonnegative(),
  choiceKey: z.string().min(1).max(96),
}).strict();

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class ExpeditionGateway {
  private readonly logger = new Logger(ExpeditionGateway.name);

  constructor(
    private readonly expeditions: ExpeditionService,
    private readonly world: WorldStateService,
    private readonly movement: MovementCoordinatorService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('expedition:catalog')
  catalog(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ExpeditionCatalogView[]>> {
    return this.handle(client, emptySchema, raw, async () =>
      this.expeditions.listCatalog(),
    );
  }

  @SubscribeMessage('expedition:get')
  getCurrent(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ExpeditionPublicView | null>> {
    return this.handle(client, emptySchema, raw, async (session) =>
      this.expeditions.getCurrent(session),
    );
  }

  @SubscribeMessage('expedition:prepare')
  prepare(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ExpeditionPublicView>> {
    return this.handle(client, prepareSchema, raw, async (session, payload) =>
      this.expeditions.prepare(session, payload),
    );
  }

  @SubscribeMessage('expedition:start')
  start(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ExpeditionPublicView>> {
    return this.handle(client, runMutationSchema, raw, async (session, payload) =>
      this.expeditions.start(session, payload),
    );
  }

  @SubscribeMessage('expedition:advance')
  advance(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ExpeditionPublicView>> {
    return this.handle(client, advanceSchema, raw, async (session, payload) =>
      this.expeditions.advance(session, payload),
    );
  }

  @SubscribeMessage('expedition:ritual')
  ritual(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ExpeditionPublicView>> {
    return this.handle(client, ritualSchema, raw, async (session, payload) =>
      this.expeditions.selectRitual(session, payload),
    );
  }

  @SubscribeMessage('expedition:extract')
  extract(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ExpeditionPublicView>> {
    return this.handle(client, runMutationSchema, raw, async (session, payload) =>
      this.expeditions.extract(session, payload),
    );
  }

  @SubscribeMessage('expedition:abandon')
  abandon(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<ExpeditionPublicView>> {
    return this.handle(client, runMutationSchema, raw, async (session, payload) =>
      this.expeditions.abandon(session, payload),
    );
  }

  private async handle<TPayload, TResult>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (session: PlayerSession, payload: TPayload) => Promise<TResult>,
  ): Promise<SocketAck<TResult>> {
    try {
      const payload = schema.parse(raw);
      const session = this.world.getBySocketId(client.id);
      if (
        !session?.activeInWorld ||
        client.data.sessionState !== 'IN_WORLD'
      ) {
        throw new GameError(
          GAME_ERROR_CODES.SESSION_NOT_READY,
          'errors.session.notReady',
        );
      }
      const data = await this.movement.runSerialized(
        session,
        () => operation(session, payload),
      );
      return { ok: true, data };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private toSocketError(
    error: unknown,
    client: GameSocket,
  ): SocketErrorPayload {
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
      'Unhandled expedition gateway error.',
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
