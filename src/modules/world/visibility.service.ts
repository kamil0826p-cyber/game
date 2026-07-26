import { Injectable } from '@nestjs/common';
import { GameConfigService } from '../../config/game-config.service.js';
import type { PublicPlayerState } from '../../contracts/socket.events.js';
import type { PlayerSession } from './player-session.types.js';
import type { PreviousPosition } from './world-state.service.js';
import { WorldStateService } from './world-state.service.js';
import { WorldEventsPublisher } from './world-events.publisher.js';

@Injectable()
export class VisibilityService {
  constructor(
    private readonly config: GameConfigService,
    private readonly worldState: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  addSession(session: PlayerSession): PublicPlayerState[] {
    const nearby = this.playersVisibleTo(session);
    for (const subject of nearby) {
      this.link(session, subject);
      if (this.canSee(subject, session)) {
        this.link(subject, session);
        this.publisher.emit(subject.socketId, 'world:playerEntered', this.worldState.toPublicState(session));
      }
    }
    return nearby.map((player) => this.worldState.toPublicState(player));
  }

  removeSession(session: PlayerSession): void {
    for (const watcherId of [...session.watcherCharacterIds]) {
      const watcher = this.worldState.getByCharacterId(watcherId);
      if (!watcher) {
        continue;
      }
      this.unlink(watcher, session);
      this.publisher.emit(watcher.socketId, 'world:playerLeft', {
        characterId: session.characterId,
      });
    }

    for (const visibleId of [...session.visibleCharacterIds]) {
      const subject = this.worldState.getByCharacterId(visibleId);
      if (subject) {
        this.unlink(session, subject);
      }
    }
  }

  afterMovement(
    session: PlayerSession,
    previous: PreviousPosition,
    suppressViewerEvents: boolean,
    serverTime = Date.now(),
  ): PublicPlayerState[] {
    const visibleNow = new Map(
      this.playersVisibleTo(session).map((player) => [player.characterId, player]),
    );

    for (const previousVisibleId of [...session.visibleCharacterIds]) {
      if (visibleNow.has(previousVisibleId)) {
        continue;
      }
      const subject = this.worldState.getByCharacterId(previousVisibleId);
      if (subject) {
        this.unlink(session, subject);
      } else {
        session.visibleCharacterIds.delete(previousVisibleId);
      }
      if (!suppressViewerEvents) {
        this.publisher.emit(session.socketId, 'world:playerLeft', {
          characterId: previousVisibleId,
        });
      }
    }

    for (const subject of visibleNow.values()) {
      if (session.visibleCharacterIds.has(subject.characterId)) {
        continue;
      }
      this.link(session, subject);
      if (!suppressViewerEvents) {
        this.publisher.emit(
          session.socketId,
          'world:playerEntered',
          this.worldState.toPublicState(subject),
        );
      }
    }

    const candidates = new Set<string>(session.watcherCharacterIds);
    for (const candidate of this.queryMaximumFov(previous.mapId, previous.x, previous.y)) {
      candidates.add(candidate.characterId);
    }
    for (const candidate of this.queryMaximumFov(session.mapId, session.x, session.y)) {
      candidates.add(candidate.characterId);
    }
    candidates.delete(session.characterId);

    for (const candidateId of candidates) {
      const viewer = this.worldState.getByCharacterId(candidateId);
      if (!viewer) {
        continue;
      }
      const wasVisible = viewer.visibleCharacterIds.has(session.characterId);
      const isVisible = this.canSee(viewer, session);
      if (wasVisible && isVisible) {
        this.publisher.emit(viewer.socketId, 'world:playerMoved', {
          ...this.worldState.toPublicState(session),
          serverTime,
        });
      } else if (wasVisible && !isVisible) {
        this.unlink(viewer, session);
        this.publisher.emit(viewer.socketId, 'world:playerLeft', {
          characterId: session.characterId,
        });
      } else if (!wasVisible && isVisible) {
        this.link(viewer, session);
        this.publisher.emit(
          viewer.socketId,
          'world:playerEntered',
          this.worldState.toPublicState(session),
        );
      }
    }

    return [...visibleNow.values()].map((player) => this.worldState.toPublicState(player));
  }

  refreshViewer(session: PlayerSession): PublicPlayerState[] {
    const visibleNow = new Map(
      this.playersVisibleTo(session).map((player) => [player.characterId, player]),
    );

    for (const previousVisibleId of [...session.visibleCharacterIds]) {
      if (!visibleNow.has(previousVisibleId)) {
        const subject = this.worldState.getByCharacterId(previousVisibleId);
        if (subject) {
          this.unlink(session, subject);
        } else {
          session.visibleCharacterIds.delete(previousVisibleId);
        }
        this.publisher.emit(session.socketId, 'world:playerLeft', {
          characterId: previousVisibleId,
        });
      }
    }

    for (const subject of visibleNow.values()) {
      if (!session.visibleCharacterIds.has(subject.characterId)) {
        this.link(session, subject);
        this.publisher.emit(
          session.socketId,
          'world:playerEntered',
          this.worldState.toPublicState(subject),
        );
      }
    }

    return [...visibleNow.values()].map((player) => this.worldState.toPublicState(player));
  }

  private playersVisibleTo(viewer: PlayerSession): PlayerSession[] {
    return this.worldState
      .queryPlayersInRectangle(
        viewer.mapId,
        viewer.x - viewer.viewport.halfWidth,
        viewer.x + viewer.viewport.halfWidth,
        viewer.y - viewer.viewport.halfHeight,
        viewer.y + viewer.viewport.halfHeight,
      )
      .filter((candidate) => candidate.characterId !== viewer.characterId);
  }

  private queryMaximumFov(mapId: string, x: number, y: number): PlayerSession[] {
    return this.worldState.queryPlayersInRectangle(
      mapId,
      x - this.config.values.MAX_FOV_HALF_WIDTH,
      x + this.config.values.MAX_FOV_HALF_WIDTH,
      y - this.config.values.MAX_FOV_HALF_HEIGHT,
      y + this.config.values.MAX_FOV_HALF_HEIGHT,
    );
  }

  private canSee(viewer: PlayerSession, subject: PlayerSession): boolean {
    return (
      viewer.mapId === subject.mapId &&
      Math.abs(viewer.x - subject.x) <= viewer.viewport.halfWidth &&
      Math.abs(viewer.y - subject.y) <= viewer.viewport.halfHeight
    );
  }

  private link(viewer: PlayerSession, subject: PlayerSession): void {
    viewer.visibleCharacterIds.add(subject.characterId);
    subject.watcherCharacterIds.add(viewer.characterId);
  }

  private unlink(viewer: PlayerSession, subject: PlayerSession): void {
    viewer.visibleCharacterIds.delete(subject.characterId);
    subject.watcherCharacterIds.delete(viewer.characterId);
  }
}
