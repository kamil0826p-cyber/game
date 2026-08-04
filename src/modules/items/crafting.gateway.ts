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
import { NpcService } from '../npcs/npc.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { WorldStateService } from '../world/world-state.service.js';
import type {
  CraftingResult,
  CraftingSnapshot,
  CraftingStationSession,
} from './crafting.contracts.js';
import { CraftingService } from './crafting.service.js';

const requestId = z.string().trim().min(1).max(96);
const craftingRequestSchema = z.object({ requestId }).strict();
const craftingCraftSchema = z
  .object({
    requestId,
    recipeKey: z.string().trim().min(1).max(96),
  })
  .strict();

type CraftingRequestPayload = z.infer<typeof craftingRequestSchema>;

@WebSocketGateway({ namespace: '/game', transports: ['websocket'] })
export class CraftingGateway {
  private readonly logger = new Logger(CraftingGateway.name);

  constructor(
    private readonly crafting: CraftingService,
    private readonly npcs: NpcService,
    private readonly worldState: WorldStateService,
    private readonly movementCoordinator: MovementCoordinatorService,
    private readonly localization: LocalizationService,
  ) {}

  @SubscribeMessage('crafting:get')
  get(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CraftingSnapshot>> {
    return this.handle(client, craftingRequestSchema, raw, async (session) => {
      const station = await this.requireStation(client, session);
      return this.crafting.getSnapshot(
        session.userId,
        session.characterId,
        station,
        await this.stationName(station.npcId),
      );
    });
  }

  @SubscribeMessage('crafting:craft')
  craft(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<CraftingResult>> {
    return this.handle(client, craftingCraftSchema, raw, async (session, payload) => {
      const station = await this.requireStation(client, session);
      this.crafting.assertStationRecipe(station.workstationKey, payload.recipeKey);
      const result = await this.crafting.craft(
        session.userId,
        session.characterId,
        station,
        await this.stationName(station.npcId),
        payload.recipeKey,
        payload.requestId,
      );
      session.silver = result.snapshot.silver;
      session.stateRevision += 1;
      session.dirty = true;
      return result;
    });
  }

  @SubscribeMessage('crafting:close')
  close(
    @ConnectedSocket() client: GameSocket,
    @MessageBody() raw: unknown,
  ): Promise<SocketAck<{ closed: boolean }>> {
    return this.handle(client, craftingRequestSchema, raw, async () => {
      const closed = Boolean(client.data.craftingStation);
      client.data.craftingStation = undefined;
      return { closed };
    });
  }

  private async requireStation(
    client: GameSocket,
    session: PlayerSession,
  ): Promise<CraftingStationSession> {
    const station = client.data.craftingStation;
    if (!station) {
      throw new GameError(
        GAME_ERROR_CODES.NPC_NOT_AVAILABLE,
        'errors.npcs.notAvailable',
      );
    }
    try {
      await this.npcs.assertInteractionAvailable(station.npcId, session);
    } catch (error) {
      client.data.craftingStation = undefined;
      throw error;
    }
    return station;
  }

  private async stationName(npcId: string): Promise<string> {
    const npc = await this.npcs.getNpcIdentity(npcId);
    return npc.name;
  }

  private async handle<TPayload extends CraftingRequestPayload, TResult>(
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
      'Unhandled crafting gateway error.',
      error instanceof Error ? error.stack : undefined,
    );
    return {
      code: GAME_ERROR_CODES.INTERNAL_ERROR,
      message: this.localization.translate('errors.internal', locale),
    };
  }
}
