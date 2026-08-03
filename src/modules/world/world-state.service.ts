import { Injectable } from '@nestjs/common';
import type { CharacterGender, Direction } from '../../common/domain/game.types.js';
import { GameConfigService } from '../../config/game-config.service.js';
import type { PublicPlayerState, SelfCharacterState } from '../../contracts/socket.events.js';
import { SpatialIndexService } from './spatial-index.service.js';
import type { CreatePlayerSessionInput, PlayerSession } from './player-session.types.js';

export interface PreviousPosition {
  mapId: string;
  x: number;
  y: number;
  direction: Direction;
}

@Injectable()
export class WorldStateService {
  private readonly sessionsByCharacterId = new Map<string, PlayerSession>();
  private readonly sessionsBySocketId = new Map<string, PlayerSession>();

  constructor(
    private readonly config: GameConfigService,
    private readonly spatialIndex: SpatialIndexService,
  ) {}

  get count(): number {
    return this.sessionsByCharacterId.size;
  }

  createSession(input: CreatePlayerSessionInput): PlayerSession {
    const character = input.character;
    const positionChanged =
      input.mapId !== character.mapId || input.x !== character.x || input.y !== character.y;
    const staleCombatState = character.combatState !== 'IDLE';
    return {
      socketId: input.socketId,
      connectionId: input.connectionId,
      characterId: character.id,
      userId: character.userId,
      realmId: character.realmId,
      name: character.name,
      characterClass: character.characterClass,
      gender: character.gender ?? 'MALE',
      level: character.level,
      experience: character.experience,
      silver: character.silver ?? 0,
      gold: character.gold ?? 0,
      outfitKey: character.outfitKey,
      mapId: input.mapId,
      x: input.x,
      y: input.y,
      direction: character.direction,
      combatState: 'IDLE',
      hp: character.hp,
      maxHp: character.maxHp,
      energy: character.energy,
      maxEnergy: character.maxEnergy,
      strength: character.strength,
      agility: character.agility,
      intelligence: character.intelligence,
      armor: character.armor,
      locale: input.locale,
      viewport: {
        halfWidth: this.config.values.FOV_HALF_WIDTH,
        halfHeight: this.config.values.FOV_HALF_HEIGHT,
      },
      connectedAt: Date.now(),
      nextMoveAllowedAt: 0,
      stateRevision: character.stateVersion + (positionChanged || staleCombatState ? 1 : 0),
      persistedRevision: character.stateVersion,
      dirty: positionChanged || staleCombatState,
      activeInWorld: input.activeInWorld ?? true,
      visibleCharacterIds: new Set<string>(),
      watcherCharacterIds: new Set<string>(),
    };
  }

  addSession(session: PlayerSession): PlayerSession | undefined {
    const existing = this.sessionsByCharacterId.get(session.characterId);
    if (existing) return existing;
    this.sessionsByCharacterId.set(session.characterId, session);
    this.sessionsBySocketId.set(session.socketId, session);
    if (session.activeInWorld) {
      this.spatialIndex.add(session.characterId, session.mapId, session.x, session.y);
    }
    return undefined;
  }

  activateSession(session: PlayerSession): void {
    if (session.activeInWorld) return;
    session.activeInWorld = true;
    this.spatialIndex.add(session.characterId, session.mapId, session.x, session.y);
  }

  removeSessionBySocket(socketId: string): PlayerSession | undefined {
    const session = this.sessionsBySocketId.get(socketId);
    if (!session) return undefined;
    if (
      this.sessionsByCharacterId.get(session.characterId)?.connectionId !== session.connectionId
    ) {
      this.sessionsBySocketId.delete(socketId);
      return undefined;
    }
    this.sessionsBySocketId.delete(socketId);
    this.sessionsByCharacterId.delete(session.characterId);
    if (session.activeInWorld) {
      this.spatialIndex.remove(session.characterId, session.mapId, session.x, session.y);
    }
    return session;
  }

  getBySocketId(socketId: string): PlayerSession | undefined {
    return this.sessionsBySocketId.get(socketId);
  }

  getByCharacterId(characterId: string): PlayerSession | undefined {
    return this.sessionsByCharacterId.get(characterId);
  }

  listSessions(): PlayerSession[] {
    return [...this.sessionsByCharacterId.values()];
  }

  updatePosition(
    session: PlayerSession,
    next: { mapId: string; x: number; y: number; direction: Direction },
  ): PreviousPosition {
    const previous: PreviousPosition = {
      mapId: session.mapId,
      x: session.x,
      y: session.y,
      direction: session.direction,
    };
    if (session.activeInWorld) {
      this.spatialIndex.move(
        session.characterId,
        previous.mapId,
        previous.x,
        previous.y,
        next.mapId,
        next.x,
        next.y,
      );
    }
    session.mapId = next.mapId;
    session.x = next.x;
    session.y = next.y;
    session.direction = next.direction;
    session.stateRevision += 1;
    session.dirty = true;
    return previous;
  }

  updateViewport(session: PlayerSession, halfWidth: number, halfHeight: number): void {
    session.viewport = {
      halfWidth: Math.min(Math.max(1, halfWidth), this.config.values.MAX_FOV_HALF_WIDTH),
      halfHeight: Math.min(Math.max(1, halfHeight), this.config.values.MAX_FOV_HALF_HEIGHT),
    };
  }

  markPersisted(characterId: string, connectionId: string, revision: number): void {
    const session = this.sessionsByCharacterId.get(characterId);
    if (!session || session.connectionId !== connectionId) return;
    session.persistedRevision = Math.max(session.persistedRevision, revision);
    if (session.stateRevision === revision) session.dirty = false;
  }

  isOccupied(mapId: string, x: number, y: number, excludingCharacterId?: string): boolean {
    const candidates = this.spatialIndex.queryRectangle(mapId, x, x, y, y);
    for (const characterId of candidates) {
      if (characterId === excludingCharacterId) continue;
      const session = this.sessionsByCharacterId.get(characterId);
      if (session?.activeInWorld && session.mapId === mapId && session.x === x && session.y === y)
        return true;
    }
    return false;
  }

  queryPlayersInRectangle(
    mapId: string,
    minimumX: number,
    maximumX: number,
    minimumY: number,
    maximumY: number,
  ): PlayerSession[] {
    const ids = this.spatialIndex.queryRectangle(mapId, minimumX, maximumX, minimumY, maximumY);
    const sessions: PlayerSession[] = [];
    for (const id of ids) {
      const session = this.sessionsByCharacterId.get(id);
      if (
        session?.activeInWorld &&
        session.mapId === mapId &&
        session.x >= minimumX &&
        session.x <= maximumX &&
        session.y >= minimumY &&
        session.y <= maximumY
      )
        sessions.push(session);
    }
    return sessions;
  }

  toPublicState(session: PlayerSession): PublicPlayerState & { gender: CharacterGender } {
    return {
      characterId: session.characterId,
      name: session.name,
      characterClass: session.characterClass,
      gender: session.gender,
      level: session.level,
      outfitKey: session.outfitKey,
      mapId: session.mapId,
      x: session.x,
      y: session.y,
      direction: session.direction,
      combatState: session.combatState,
    };
  }

  toSelfState(session: PlayerSession): SelfCharacterState & { gender: CharacterGender } {
    return {
      ...this.toPublicState(session),
      experience: session.experience,
      silver: session.silver,
      gold: session.gold,
      hp: session.hp,
      maxHp: session.maxHp,
      energy: session.energy,
      maxEnergy: session.maxEnergy,
      strength: session.strength,
      agility: session.agility,
      intelligence: session.intelligence,
      armor: session.armor,
    };
  }
}
