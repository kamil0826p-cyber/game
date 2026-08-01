import {
  ConnectedSocket,
  MessageBody,
  type OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { z, ZodError } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { MobStatePayload } from '../../contracts/mob.events.js';
import type {
  CombatSnapshot,
  GameSocket,
  SocketAck,
  SocketErrorPayload,
} from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { WorldStateService } from '../world/world-state.service.js';
import { MobCoordinatorService } from './mob-coordinator.service.js';
import { PveCombatService } from './pve-combat.service.js';

const requestId = z.string().min(1).max(64);
const operationId = z.string().min(1).max(96);
const actorId = z.string().trim().min(1).max(128);
const listSchema = z.object({ requestId }).strict();
const requestSchema = z.object({ requestId, mobId: z.string().uuid() }).strict();
const combatSchema = z.object({ requestId, combatId: z.string().uuid() }).strict();
const operationFields = {
  operationId: operationId.optional(),
  expectedTurnNumber: z.number().int().min(1).optional(),
  contractVersion: z.literal(2).optional(),
};
const actionSchema = z.discriminatedUnion('action', [
  z
    .object({
      requestId,
      combatId: z.string().uuid(),
      action: z.literal('BASIC_ATTACK'),
      targetActorId: actorId.optional(),
      ...operationFields,
    })
    .strict(),
  z
    .object({
      requestId,
      combatId: z.string().uuid(),
      action: z.literal('SKILL'),
      skillKey: z
        .string()
        .trim()
        .min(1)
        .max(96)
        .regex(/^[a-z0-9-]+$/),
      targetActorId: actorId.optional(),
      ...operationFields,
    })
    .strict(),
  z
    .object({
      requestId,
      combatId: z.string().uuid(),
      action: z.enum([
        'DEFEND',
        'INTERCEPT',
        'TAUNT',
        'INTERRUPT',
        'CLEANSE',
        'MARK',
        'COUNTER',
        'REPOSITION',
        'TRANSFER_ENERGY',
        'SKIP',
      ]),
      targetActorId: actorId.optional(),
      ...operationFields,
    })
    .strict(),
]);

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class MobGateway implements OnGatewayDisconnect {
  constructor(
    private readonly mobs: MobCoordinatorService,
    private readonly combat: PveCombatService,
    private readonly world: WorldStateService,
    private readonly localization: LocalizationService,
  ) {}

  async handleDisconnect(client: GameSocket): Promise<void> {
    const characterId = client.data.characterId;
    if (characterId) await this.combat.handleDisconnect(characterId);
  }

  @SubscribeMessage('mobs:get')
  getMapMobs(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): SocketAck<{ mapId: string; mobs: MobStatePayload[] }> {
    try {
      listSchema.parse(raw);
      const session = this.requireSession(client);
      return {
        ok: true,
        data: { mapId: session.mapId, mobs: this.mobs.getMapMobs(session.mapId) },
      };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('pve:getActive')
  async getActive(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot | null>> {
    try {
      listSchema.parse(raw);
      const session = this.requireSession(client);
      return {
        ok: true,
        data: await this.combat.getActive(session.userId, session.characterId),
      };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('pve:request')
  async requestCombat(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot>> {
    try {
      const payload = requestSchema.parse(raw);
      const session = this.requireSession(client);
      return {
        ok: true,
        data: await this.combat.request(
          session.userId,
          session.characterId,
          payload.mobId,
        ),
      };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('pve:act')
  async act(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot>> {
    try {
      const payload = actionSchema.parse(raw);
      const session = this.requireSession(client);
      return {
        ok: true,
        data: await this.combat.act(
          session.userId,
          session.characterId,
          payload.combatId,
          payload,
        ),
      };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  @SubscribeMessage('pve:leave')
  async leave(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CombatSnapshot>> {
    try {
      const payload = combatSchema.parse(raw);
      const session = this.requireSession(client);
      return {
        ok: true,
        data: await this.combat.leave(
          session.userId,
          session.characterId,
          payload.combatId,
        ),
      };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private requireSession(client: GameSocket) {
    const session = this.world.getBySocketId(client.id);
    if (!session?.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
      throw new GameError(
        GAME_ERROR_CODES.SESSION_NOT_READY,
        'errors.session.notReady',
      );
    }
    return session;
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
