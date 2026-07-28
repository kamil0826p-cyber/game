import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module.js';
import { GameConfigModule } from './config/game-config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LocalizationModule } from './i18n/localization.module.js';
import { CharacterModule } from './modules/characters/character.module.js';
import { ItemModule } from './modules/items/item.module.js';
import { MapModule } from './modules/maps/map.module.js';
import { MovementModule } from './modules/movement/movement.module.js';
import { NpcInteractionModule } from './modules/npcs/npc-interaction.module.js';
import { PersistenceModule } from './modules/persistence/persistence.module.js';
import { TradeModule } from './modules/player/trade/trade.module.js';
import { RealmModule } from './modules/realm/realm.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { WorldModule } from './modules/world/world.module.js';

@Module({
  imports: [GameConfigModule, DatabaseModule, LocalizationModule, AuthModule, RealmModule, MapModule, CharacterModule, WorldModule, PersistenceModule, MovementModule, RealtimeModule, ItemModule, NpcInteractionModule, TradeModule, HealthModule],
})
export class AppModule {}
