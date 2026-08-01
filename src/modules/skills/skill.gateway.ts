import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { z, ZodError, type ZodType } from 'zod';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import type { GameSocket, SocketAck, SocketErrorPayload } from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import { SkillService, type SkillRespecPreview } from './skill.service.js';
import type { SkillBuildSnapshot } from './skill.buildcraft.types.js';

const requestId = z.string().trim().min(1).max(128);
const operationId = z.string().trim().min(1).max(64);
const version = z.number().int().min(1);
const nodeRanks = z.record(z.string().min(1).max(96), z.number().int().min(0).max(3));
const fallbackAction = z.enum(['DEFEND', 'BASIC_ATTACK', 'SKIP']);

const skillRequestSchema = z.object({ requestId });
const skillUnlockSchema = skillRequestSchema.extend({ skillKey: z.string().min(1).max(96) });
const specializationSchema = skillRequestSchema.extend({
  operationId,
  expectedVersion: version,
  specializationKey: z.string().min(1).max(96),
});
const loadoutSaveSchema = skillRequestSchema.extend({
  operationId,
  expectedVersion: version,
  loadoutId: z.string().uuid().or(z.literal('default')).optional(),
  name: z.string().trim().min(1).max(32),
  activeSkillKeys: z.array(z.string().min(1).max(96)).max(8),
  passiveNodeKeys: z.array(z.string().min(1).max(96)).max(4),
  fallbackAction,
});
const loadoutActivateSchema = skillRequestSchema.extend({
  operationId,
  expectedVersion: version,
  loadoutId: z.string().uuid().or(z.literal('default')),
});
const respecPreviewSchema = skillRequestSchema.extend({
  selectedSpecializationKey: z.string().min(1).max(96).optional(),
  ranks: nodeRanks,
});
const respecSchema = respecPreviewSchema.extend({
  operationId,
  expectedVersion: version,
});

type RequestPayload = z.infer<typeof skillRequestSchema>;

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class SkillGateway {
  private readonly logger = new Logger(SkillGateway.name);

  constructor(
    private readonly skills: SkillService,
    private readonly worldState: WorldStateService,
    private readonly movementCoordinator: MovementCoordinatorService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('skills:get')
  getSkills(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<SkillBuildSnapshot>> {
    return this.handle(client, skillRequestSchema, raw, (session) =>
      this.skills.getSnapshot(session.userId, session.characterId),
    );
  }

  @SubscribeMessage('skills:unlock')
  unlockSkill(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<SkillBuildSnapshot>> {
    return this.handle(client, skillUnlockSchema, raw, (session, payload) =>
      this.skills.unlock(session.userId, session.characterId, payload.skillKey),
    );
  }

  @SubscribeMessage('skills:specialization')
  selectSpecialization(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<SkillBuildSnapshot>> {
    return this.handle(client, specializationSchema, raw, (session, payload) =>
      this.skills.chooseSpecialization(session.userId, session.characterId, payload),
    );
  }

  @SubscribeMessage('skills:loadoutSave')
  saveLoadout(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<SkillBuildSnapshot>> {
    return this.handle(client, loadoutSaveSchema, raw, (session, payload) =>
      this.skills.saveLoadout(session.userId, session.characterId, payload),
    );
  }

  @SubscribeMessage('skills:loadoutActivate')
  activateLoadout(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<SkillBuildSnapshot>> {
    return this.handle(client, loadoutActivateSchema, raw, (session, payload) =>
      this.skills.activateLoadout(session.userId, session.characterId, payload),
    );
  }

  @SubscribeMessage('skills:respecPreview')
  previewRespec(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<SkillRespecPreview>> {
    return this.handle(client, respecPreviewSchema, raw, (session, payload) =>
      this.skills.previewRespec(session.userId, session.characterId, payload),
    );
  }

  @SubscribeMessage('skills:respec')
  respec(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<SkillBuildSnapshot>> {
    return this.handle(client, respecSchema, raw, (session, payload) =>
      this.skills.respec(session.userId, session.characterId, payload),
    );
  }

  private async handle<TPayload extends RequestPayload, TResult>(
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
      'Unhandled skill gateway error.',
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
