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
  MILESTONE_KEYS,
  type MilestoneRanks,
} from './progression/character-progression.rules.js';
import { CharacterProgressionService } from './progression/character-progression.service.js';
import type { CharacterProgressionSnapshot } from './progression/character-progression.types.js';

const requestId = z.string().trim().min(1).max(64);
const progressionRequestSchema = z.object({ requestId }).strict();
const milestoneAllocateSchema = z
  .object({
    requestId,
    milestoneKey: z.enum(MILESTONE_KEYS),
  })
  .strict();
const milestoneSelectionSchema = z
  .object({
    key: z.enum(MILESTONE_KEYS),
    rank: z.number().int().min(0).max(5),
  })
  .strict();
const respecSchema = z
  .object({
    requestId,
    operationId: z.string().trim().min(1).max(64),
    milestones: z.array(milestoneSelectionSchema).max(MILESTONE_KEYS.length).default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = value.milestones.map((milestone) => milestone.key);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({ code: 'custom', message: 'Duplicate milestone key.' });
    }
  });

type ProgressionRequest = z.infer<typeof progressionRequestSchema>;
type MilestoneAllocateRequest = z.infer<typeof milestoneAllocateSchema>;
type RespecRequest = z.infer<typeof respecSchema>;

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class CharacterProgressionGateway {
  private readonly logger = new Logger(CharacterProgressionGateway.name);

  constructor(
    private readonly progression: CharacterProgressionService,
    private readonly worldState: WorldStateService,
    private readonly movementCoordinator: MovementCoordinatorService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('progression:get')
  getProgression(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CharacterProgressionSnapshot>> {
    return this.handle(client, progressionRequestSchema, raw, (session) =>
      this.progression.getSnapshot(session.userId, session.characterId),
    );
  }

  @SubscribeMessage('progression:allocate')
  allocateMilestone(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CharacterProgressionSnapshot>> {
    return this.handle(client, milestoneAllocateSchema, raw, (session, payload) =>
      this.progression.allocateMilestone(
        session.userId,
        session.characterId,
        payload.milestoneKey,
      ),
    );
  }

  @SubscribeMessage('progression:respec')
  respec(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CharacterProgressionSnapshot>> {
    return this.handle(client, respecSchema, raw, (session, payload) =>
      this.progression.respec(
        session.userId,
        session.characterId,
        payload.operationId,
        this.toMilestoneRanks(payload.milestones),
      ),
    );
  }

  private async handle<TPayload>(
    client: GameSocket,
    schema: ZodType<TPayload>,
    raw: unknown,
    operation: (
      session: PlayerSession,
      payload: TPayload,
    ) => Promise<CharacterProgressionSnapshot>,
  ): Promise<SocketAck<CharacterProgressionSnapshot>> {
    try {
      const payload = schema.parse(raw);
      const session = this.worldState.getBySocketId(client.id);
      if (!session || !session.activeInWorld || client.data.sessionState !== 'IN_WORLD') {
        throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
      }
      const snapshot = await this.movementCoordinator.runSerialized(session, () =>
        operation(session, payload),
      );
      this.syncSession(session, snapshot);
      return { ok: true, data: snapshot };
    } catch (error) {
      return { ok: false, error: this.toSocketError(error, client) };
    }
  }

  private syncSession(
    session: PlayerSession,
    snapshot: CharacterProgressionSnapshot,
  ): void {
    if (snapshot.stateVersion < session.persistedRevision) return;
    session.hp = snapshot.current.hp;
    session.maxHp = snapshot.effective.maxHp;
    session.energy = snapshot.current.energy;
    session.maxEnergy = snapshot.effective.maxEnergy;
    session.strength = snapshot.effective.strength;
    session.agility = snapshot.effective.agility;
    session.intelligence = snapshot.effective.intelligence;
    session.armor = snapshot.effective.armor;
    session.silver = snapshot.current.silver;
    session.stateRevision = Math.max(session.stateRevision + 1, snapshot.stateVersion);
    session.persistedRevision = Math.max(session.persistedRevision, snapshot.stateVersion);
    session.dirty = true;
  }

  private toMilestoneRanks(milestones: RespecRequest['milestones']): MilestoneRanks {
    return Object.fromEntries(
      milestones
        .filter((milestone) => milestone.rank > 0)
        .map((milestone) => [milestone.key, milestone.rank]),
    ) as MilestoneRanks;
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
    if (error instanceof Error && error.message.startsWith('MILESTONE_')) {
      return {
        code: GAME_ERROR_CODES.INVALID_PAYLOAD,
        message: this.localization.translate('errors.payload.invalid', locale),
        details: { reason: error.message },
      };
    }
    this.logger.error(
      'Unhandled character progression gateway error.',
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
