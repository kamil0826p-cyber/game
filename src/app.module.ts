import { Module } from '@nestjs/common';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { AuthModule } from './auth/auth.module.js';
import { GameConfigModule } from './config/game-config.module.js';
import { ContentModule } from './content/content.module.js';
import { DatabaseModule } from './database/database.module.js';
import { DomainEventsModule } from './domain-events/domain-events.module.js';
import { HealthModule } from './health/health.module.js';
import { LocalizationModule } from './i18n/localization.module.js';
import { CharacterModule } from './modules/characters/character.module.js';
import { CombatModule } from './modules/combat/combat.module.js';
import { GroupModule } from './modules/groups/group.module.js';
import { GuildModule } from './modules/guilds/guild.module.js';
import { ItemModule } from './modules/items/item.module.js';
import { MapModule } from './modules/maps/map.module.js';
import { MobModule } from './modules/mobs/mob.module.js';
import { MovementModule } from './modules/movement/movement.module.js';
import { NpcInteractionModule } from './modules/npcs/npc-interaction.module.js';
import { PersistenceModule } from './modules/persistence/persistence.module.js';
import { TradeModule } from './modules/player/trade/trade.module.js';
import { ProgressionModule } from './modules/progression/progression.module.js';
import { QuestModule } from './modules/quests/quest.module.js';
import { RealmModule } from './modules/realm/realm.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { SkillModule } from './modules/skills/skill.module.js';
import { WorldModule } from './modules/world/world.module.js';

@Module({
  imports: [
    GameConfigModule,
    DatabaseModule,
    DomainEventsModule,
    AnalyticsModule,
    ContentModule,
    LocalizationModule,
    AuthModule,
    RealmModule,
    MapModule,
    CharacterModule,
    ProgressionModule,
    QuestModule,
    MobModule,
    CombatModule,
    WorldModule,
    PersistenceModule,
    MovementModule,
    SkillModule,
    GuildModule,
    GroupModule,
    RealtimeModule,
    ItemModule,
    NpcInteractionModule,
    TradeModule,
    HealthModule,
  ],
})
export class AppModule {}
