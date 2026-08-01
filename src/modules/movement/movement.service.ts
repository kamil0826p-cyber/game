import { Injectable, Logger } from '@nestjs/common';
import { AnalyticsTrackingService } from '../../analytics/analytics-tracking.service.js';
import { DIRECTION_DELTAS, type Direction } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { GameConfigService } from '../../config/game-config.service.js';
import type {
  MapStatePayload,
  MovementCommittedPayload,
  MovementRejectedPayload,
} from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { MapService } from '../maps/map.service.js';
import type { RuntimeMap } from '../maps/runtime-map.types.js';
import { NpcService } from '../npcs/npc.service.js';
import { PlayerPersistenceService } from '../persistence/player-persistence.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { VisibilityService } from '../world/visibility.service.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import type { MovementAttemptResult, MovementSource } from './movement.types.js';

@Injectable()
export class MovementService {
  private readonly logger = new Logger(MovementService.name);

  constructor(
    private readonly config: GameConfigService,
    private readonly maps: MapService,
    private readonly npcs: NpcService,
    private readonly worldState: WorldStateService,
    private readonly visibility: VisibilityService,
    private readonly publisher: WorldEventsPublisher,
    private readonly localization: LocalizationService,
    private readonly persistence: PlayerPersistenceService,
    private readonly analytics: AnalyticsTrackingService,
  ) {}

  async performStep(
    session: PlayerSession,
    direction: Direction,
    source: MovementSource,
    requestId?: string,
  ): Promise<MovementAttemptResult> {
    if (this.worldState.getByCharacterId(session.characterId)?.connectionId !== session.connectionId) {
      return this.reject(
        session,
        new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady'),
        requestId,
      );
    }

    const attemptedAt = Date.now();
    if (attemptedAt < session.nextMoveAllowedAt) {
      return this.reject(
        session,
        new GameError(GAME_ERROR_CODES.MOVE_TOO_FAST, 'errors.movement.tooFast'),
        requestId,
        session.nextMoveAllowedAt - attemptedAt,
      );
    }

    const sourceMap = await this.maps.getMap(session.mapId);
    const delta = DIRECTION_DELTAS[direction];
    const stepX = session.x + delta.x;
    const stepY = session.y + delta.y;

    if (!this.maps.isInside(sourceMap, stepX, stepY)) {
      return this.reject(
        session,
        new GameError(
          GAME_ERROR_CODES.MOVE_OUT_OF_BOUNDS,
          'errors.movement.outOfBounds',
        ),
        requestId,
      );
    }
    if (this.maps.isCollision(sourceMap, stepX, stepY)) {
      return this.reject(
        session,
        new GameError(GAME_ERROR_CODES.MOVE_COLLISION, 'errors.movement.collision'),
        requestId,
      );
    }
    if (await this.npcs.isTileOccupied(sourceMap.id, stepX, stepY)) {
      return this.reject(
        session,
        new GameError(
          GAME_ERROR_CODES.MOVE_TILE_OCCUPIED,
          'errors.movement.occupied',
          { occupantType: 'NPC' },
        ),
        requestId,
      );
    }
    if (
      sourceMap.zoneType !== 'SAFE' &&
      this.worldState.isOccupied(sourceMap.id, stepX, stepY, session.characterId)
    ) {
      return this.reject(
        session,
        new GameError(
          GAME_ERROR_CODES.MOVE_TILE_OCCUPIED,
          'errors.movement.occupied',
        ),
        requestId,
      );
    }

    const portal = this.maps.getPortalAt(sourceMap, stepX, stepY);
    let destinationMap = sourceMap;
    let destinationX = stepX;
    let destinationY = stepY;

    if (portal) {
      destinationMap = await this.maps.getMap(portal.destinationMapId);
      destinationX = portal.targetX;
      destinationY = portal.targetY;
      if (
        !this.maps.isInside(destinationMap, destinationX, destinationY) ||
        this.maps.isCollision(destinationMap, destinationX, destinationY)
      ) {
        return this.reject(
          session,
          new GameError(GAME_ERROR_CODES.PORTAL_INVALID, 'errors.portal.invalid'),
          requestId,
        );
      }
      if (await this.npcs.isTileOccupied(destinationMap.id, destinationX, destinationY)) {
        return this.reject(
          session,
          new GameError(
            GAME_ERROR_CODES.MOVE_TILE_OCCUPIED,
            'errors.movement.occupied',
            { occupantType: 'NPC' },
          ),
          requestId,
        );
      }
      if (
        destinationMap.zoneType !== 'SAFE' &&
        this.worldState.isOccupied(
          destinationMap.id,
          destinationX,
          destinationY,
          session.characterId,
        )
      ) {
        return this.reject(
          session,
          new GameError(
            GAME_ERROR_CODES.MOVE_TILE_OCCUPIED,
            'errors.movement.occupied',
          ),
          requestId,
        );
      }
    }

    const committedAt = Date.now();
    session.nextMoveAllowedAt = committedAt + this.config.values.MOVE_STEP_MS;
    const previous = this.worldState.updatePosition(session, {
      mapId: destinationMap.id,
      x: destinationX,
      y: destinationY,
      direction,
    });
    const nearbyPlayers = this.visibility.afterMovement(
      session,
      previous,
      Boolean(portal),
      committedAt,
    );

    const payload: MovementCommittedPayload = {
      requestId,
      source,
      mapId: session.mapId,
      x: session.x,
      y: session.y,
      direction: session.direction,
      serverTime: committedAt,
      portalTransition: portal
        ? {
            sourceMapId: sourceMap.id,
            destinationMapId: destinationMap.id,
            targetX: destinationX,
            targetY: destinationY,
          }
        : undefined,
    };

    this.publisher.emit(session.socketId, 'movement:committed', payload);

    if (portal) {
      this.publisher.emit(session.socketId, 'world:mapChanged', {
        map: this.toMapState(destinationMap),
        npcs: await this.npcs.getMapNpcs(destinationMap.id),
        self: this.worldState.toSelfState(session),
        nearbyPlayers,
        serverTime: committedAt,
      });
      void this.analytics.regionEntered(session, 'PORTAL', sourceMap.id);
      const snapshot = this.persistence.capture(session);
      void this.persistence
        .persistSnapshot(snapshot, 'portal')
        .then(() => {
          this.worldState.markPersisted(
            snapshot.characterId,
            snapshot.connectionId,
            snapshot.revision,
          );
        })
        .catch((error: unknown) => {
          this.logger.error(
            `Portal checkpoint failed for character ${session.characterId}.`,
            error instanceof Error ? error.stack : undefined,
          );
        });
    }

    return { accepted: true, payload };
  }

  toMapState(map: RuntimeMap): MapStatePayload {
    return {
      id: map.id,
      key: map.key,
      name: map.name,
      width: map.width,
      height: map.height,
      zoneType: map.zoneType,
      version: map.version,
    };
  }

  private reject(
    session: PlayerSession,
    error: GameError,
    requestId?: string,
    retryAfterMs?: number,
  ): MovementAttemptResult {
    const payload: MovementRejectedPayload = {
      requestId,
      code: error.code,
      message: this.localization.translate(error.messageKey, session.locale),
      details: error.details,
      retryAfterMs,
      authoritative: {
        mapId: session.mapId,
        x: session.x,
        y: session.y,
        direction: session.direction,
      },
    };
    this.publisher.emit(session.socketId, 'movement:rejected', payload);
    return { accepted: false, error: payload };
  }
}
