import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PersistedCharacterState } from '../../common/domain/game.types.js';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { GameConfigService } from '../../config/game-config.service.js';
import type { GameSocket, WorldSpawnPayload } from '../../contracts/socket.events.js';
import { LocalizationService } from '../../i18n/localization.service.js';
import { CharacterService, MAX_CHARACTERS_PER_REALM } from '../characters/character.service.js';
import { CombatService } from '../combat/combat.service.js';
import type { CreateCharacterInput } from '../characters/character.types.js';
import { getUnlockedOutfits } from '../characters/outfit.catalog.js';
import { MapService } from '../maps/map.service.js';
import type { RuntimeMap } from '../maps/runtime-map.types.js';
import { MovementCoordinatorService } from '../movement/movement-coordinator.service.js';
import { MovementService } from '../movement/movement.service.js';
import { NpcService } from '../npcs/npc.service.js';
import { PlayerPersistenceService } from '../persistence/player-persistence.service.js';
import { RealmService } from '../realm/realm.service.js';
import { SkillService } from '../skills/skill.service.js';
import type { PlayerSession } from '../world/player-session.types.js';
import { VisibilityService } from '../world/visibility.service.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { SessionClaimExecutor } from './session-claim.executor.js';
import { createWorldEntryOccupancyPredicate } from './world-entry-occupancy.js';

export interface CharacterRosterEntry {
  characterId: string;
  name: string;
  characterClass: PersistedCharacterState['characterClass'];
  gender: NonNullable<PersistedCharacterState['gender']>;
  level: number;
  experience: number;
  outfitKey: string;
  mapId: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  energy: number;
  maxEnergy: number;
}

export interface CharacterRosterPayload {
  characters: CharacterRosterEntry[];
  maxCharacters: number;
}

@Injectable()
export class SessionLifecycleService {
  private readonly logger = new Logger(SessionLifecycleService.name);

  constructor(
    private readonly config: GameConfigService,
    private readonly characters: CharacterService,
    private readonly realms: RealmService,
    private readonly maps: MapService,
    private readonly npcs: NpcService,
    private readonly movement: MovementCoordinatorService,
    private readonly movementService: MovementService,
    private readonly persistence: PlayerPersistenceService,
    private readonly worldState: WorldStateService,
    private readonly visibility: VisibilityService,
    private readonly publisher: WorldEventsPublisher,
    private readonly localization: LocalizationService,
    private readonly sessionClaims: SessionClaimExecutor,
    private readonly skills: SkillService,
    private readonly combats: CombatService,
  ) {}

  async initializeConnection(client: GameSocket): Promise<void> {
    this.assertSocketConnected(client);
    client.data.sessionState = 'INITIALIZING';
    const auth = client.data.auth;
    if (!auth) throw new GameError(GAME_ERROR_CODES.AUTH_REQUIRED, 'errors.auth.required');

    client.data.locale = this.localization.resolveLocale(client.handshake.auth?.locale ?? client.handshake.query.locale);
    const user = await this.characters.synchronizeFirebaseUser(auth);
    client.data.userId = user.id;
    const realm = await this.realms.getCurrentRealm();
    const roster = await this.characters.listCharactersForCurrentRealm(user.id);

    this.assertSocketConnected(client);
    client.emit('session:ready', {
      realm: { id: realm.id, slug: realm.slug, name: realm.name },
      requiresCharacter: roster.length === 0,
      serverTime: Date.now(),
    });

    if (roster.length === 0) {
      client.data.sessionState = 'CHARACTER_REQUIRED';
      client.emit('character:required', { allowedClasses: ['MAGE', 'WARRIOR', 'ARCHER'] });
      return;
    }

    await this.prepareCharacterSelection(client, roster[0]!);
  }

  async listCharacters(client: GameSocket): Promise<CharacterRosterPayload> {
    this.assertSocketConnected(client);
    if (!client.data.userId) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    const characters = await this.characters.listCharactersForCurrentRealm(client.data.userId);
    return { characters: characters.map((character) => this.toRosterEntry(character)), maxCharacters: MAX_CHARACTERS_PER_REALM };
  }

  async createCharacter(client: GameSocket, input: CreateCharacterInput): Promise<WorldSpawnPayload> {
    this.assertSocketConnected(client);
    if (!client.data.userId || !['CHARACTER_REQUIRED', 'CHARACTER_SELECT'].includes(client.data.sessionState ?? '')) {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }

    await this.clearPreparedSelection(client);
    client.data.sessionState = 'INITIALIZING';
    try {
      const character = await this.characters.createCharacter(client.data.userId, input);
      this.assertSocketConnected(client);
      return await this.prepareCharacterSelection(client, character);
    } catch (error) {
      if (client.connected && !this.worldState.getBySocketId(client.id)) client.data.sessionState = 'CHARACTER_REQUIRED';
      throw error;
    }
  }

  async selectCharacter(client: GameSocket, characterId: string): Promise<WorldSpawnPayload> {
    this.assertSocketConnected(client);
    if (!client.data.userId || client.data.sessionState === 'IN_WORLD') {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    const character = await this.characters.findCharacterForCurrentRealm(client.data.userId, characterId);
    if (!character) throw new GameError(GAME_ERROR_CODES.CHARACTER_NOT_FOUND, 'errors.character.required');
    await this.clearPreparedSelection(client);
    client.data.sessionState = 'INITIALIZING';
    return this.prepareCharacterSelection(client, character);
  }

  async updateCharacterOutfit(client: GameSocket, characterId: string, outfitKey: string): Promise<CharacterRosterEntry> {
    this.assertSocketConnected(client);
    if (!client.data.userId || client.data.sessionState === 'IN_WORLD') {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }
    const character = await this.characters.updateOutfit(client.data.userId, characterId, outfitKey);
    const selected = this.worldState.getBySocketId(client.id);
    if (selected?.characterId === character.id) selected.outfitKey = character.outfitKey;
    return this.toRosterEntry(character);
  }

  async enterWorld(client: GameSocket): Promise<WorldSpawnPayload> {
    this.assertSocketConnected(client);
    const session = this.worldState.getBySocketId(client.id);
    if (!session || client.data.sessionState !== 'CHARACTER_SELECT') {
      throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    }

    const map = await this.maps.getMap(session.mapId);
    const position = this.maps.findNearestWalkable(
      map,
      { x: session.x, y: session.y },
      createWorldEntryOccupancyPredicate(this.worldState, map.id, session.characterId),
    );
    if (position.x !== session.x || position.y !== session.y) {
      this.worldState.updatePosition(session, { mapId: map.id, x: position.x, y: position.y, direction: session.direction });
    }

    this.worldState.activateSession(session);
    client.data.sessionState = 'IN_WORLD';
    const payload = await this.buildPayload(session, map, this.visibility.addSession(session));
    client.emit('world:spawn', payload);
    return payload;
  }

  async disconnect(client: GameSocket): Promise<void> {
    client.data.sessionState = 'DISCONNECTED';
    const session = this.worldState.getBySocketId(client.id);
    if (!session) return;

    await this.combats.handleDisconnect(session.characterId);
    const snapshot = await this.movement.quiesce(session, () => {
      const activeSession = this.worldState.getBySocketId(client.id);
      if (!activeSession || activeSession.connectionId !== session.connectionId) return undefined;
      const captured = this.persistence.capture(activeSession);
      if (activeSession.activeInWorld) this.visibility.removeSession(activeSession);
      this.worldState.removeSessionBySocket(client.id);
      return captured;
    });

    if (snapshot) await this.persistence.queueDetachedSnapshot(snapshot);
  }

  private prepareCharacterSelection(client: GameSocket, character: PersistedCharacterState): Promise<WorldSpawnPayload> {
    return this.sessionClaims.run(character.id, () => this.prepareWithExclusiveClaim(client, character));
  }

  private async prepareWithExclusiveClaim(client: GameSocket, initialCharacter: PersistedCharacterState): Promise<WorldSpawnPayload> {
    this.assertSocketConnected(client);
    await this.persistence.flushDetachedCharacter(initialCharacter.id);

    const existing = this.worldState.getByCharacterId(initialCharacter.id);
    if (existing) await this.replaceExistingSession(existing);

    await this.persistence.flushDetachedCharacter(initialCharacter.id);
    const character = await this.characters.findCharacterForCurrentRealm(initialCharacter.userId, initialCharacter.id);
    if (!character) throw new GameError(GAME_ERROR_CODES.CHARACTER_REQUIRED, 'errors.character.required');

    this.assertSocketConnected(client);
    const resolved = await this.resolveSpawn(character);
    this.assertSocketConnected(client);

    const session = this.worldState.createSession({
      socketId: client.id,
      connectionId: randomUUID(),
      locale: client.data.locale ?? 'en',
      character,
      mapId: resolved.map.id,
      x: resolved.x,
      y: resolved.y,
      activeInWorld: false,
    });
    const collision = this.worldState.addSession(session);
    if (collision) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');

    client.data.characterId = session.characterId;
    client.data.sessionState = 'CHARACTER_SELECT';
    const payload = await this.buildPayload(session, resolved.map, []);
    client.emit('world:spawn', payload);

    if (session.dirty) {
      const snapshot = this.persistence.capture(session);
      void this.persistence.persistSnapshot(snapshot, 'repair').then(() => {
        this.worldState.markPersisted(snapshot.characterId, snapshot.connectionId, snapshot.revision);
      }).catch((error: unknown) => {
        this.logger.error(`Initial position repair failed for character ${snapshot.characterId}.`, error instanceof Error ? error.stack : undefined);
      });
    }

    return payload;
  }

  private async clearPreparedSelection(client: GameSocket): Promise<void> {
    const session = this.worldState.getBySocketId(client.id);
    if (!session) return;
    if (session.activeInWorld) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
    const snapshot = this.persistence.capture(session);
    this.worldState.removeSessionBySocket(client.id);
    client.data.characterId = undefined;
    if (session.dirty) await this.persistence.queueDetachedSnapshot(snapshot);
  }

  private async buildPayload(session: PlayerSession, map: RuntimeMap, nearbyPlayers: ReturnType<VisibilityService['addSession']>): Promise<WorldSpawnPayload> {
    return {
      self: this.worldState.toSelfState(session),
      map: this.movementService.toMapState(map),
      npcs: await this.npcs.getMapNpcs(map.id),
      nearbyPlayers,
      unlockedOutfits: getUnlockedOutfits(session.characterClass, session.level).map((outfit) => ({ key: outfit.key, unlockLevel: outfit.unlockLevel })),
      skillTree: await this.skills.getSnapshot(session.userId, session.characterId),
      movementStepMs: this.config.values.MOVE_STEP_MS,
      serverTime: Date.now(),
    };
  }

  private toRosterEntry(character: PersistedCharacterState): CharacterRosterEntry {
    return {
      characterId: character.id,
      name: character.name,
      characterClass: character.characterClass,
      gender: character.gender ?? 'MALE',
      level: character.level,
      experience: character.experience,
      outfitKey: character.outfitKey,
      mapId: character.mapId,
      x: character.x,
      y: character.y,
      hp: character.hp,
      maxHp: character.maxHp,
      energy: character.energy,
      maxEnergy: character.maxEnergy,
    };
  }

  private async resolveSpawn(character: PersistedCharacterState): Promise<{ map: RuntimeMap; x: number; y: number }> {
    const realm = await this.realms.getCurrentRealm();
    let map: RuntimeMap;
    try {
      map = await this.maps.getMap(character.mapId);
      if (map.realmId !== realm.id) throw new GameError(GAME_ERROR_CODES.MAP_INVALID, 'errors.map.invalid');
    } catch (error) {
      if (!(error instanceof GameError) || error.code !== GAME_ERROR_CODES.MAP_INVALID) throw error;
      map = await this.maps.getMap(realm.defaultMapId);
    }

    const position = this.maps.findNearestWalkable(map, map.id === character.mapId ? { x: character.x, y: character.y } : map.spawn, () => false);
    return { map, x: position.x, y: position.y };
  }

  private async replaceExistingSession(existing: PlayerSession): Promise<void> {
    await this.combats.handleDisconnect(existing.characterId);
    const snapshot = await this.movement.quiesce(existing, () => {
      const activeSession = this.worldState.getByCharacterId(existing.characterId);
      if (!activeSession || activeSession.connectionId !== existing.connectionId) return undefined;
      const captured = this.persistence.capture(activeSession);
      if (activeSession.activeInWorld) this.visibility.removeSession(activeSession);
      this.worldState.removeSessionBySocket(activeSession.socketId);
      return captured;
    });

    if (!snapshot) return;
    try {
      await this.persistence.queueDetachedSnapshot(snapshot);
    } finally {
      this.publisher.emit(existing.socketId, 'notification', {
        code: 'SESSION_REPLACED',
        message: this.localization.translate('notifications.sessionReplaced', existing.locale),
      });
      this.publisher.disconnect(existing.socketId);
    }
  }

  private assertSocketConnected(client: GameSocket): void {
    if (!client.connected) throw new GameError(GAME_ERROR_CODES.SESSION_NOT_READY, 'errors.session.notReady');
  }
}
