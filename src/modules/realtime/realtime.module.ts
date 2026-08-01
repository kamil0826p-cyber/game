import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { AdminModule } from '../admin/admin.module.js';
import { CharacterModule } from '../characters/character.module.js';
import { CombatModule } from '../combat/combat.module.js';
import { MapModule } from '../maps/map.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { NpcModule } from '../npcs/npc.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { ProgressionModule } from '../progression/progression.module.js';
import { RealmModule } from '../realm/realm.module.js';
import { SkillModule } from '../skills/skill.module.js';
import { WorldModule } from '../world/world.module.js';
import { CharacterRosterGateway } from './character-roster.gateway.js';
import { GameGateway } from './game.gateway.js';
import { SessionClaimExecutor } from './session-claim.executor.js';
import { SessionLifecycleService } from './session-lifecycle.service.js';

@Module({
  imports: [
    AuthModule,
    AdminModule,
    CharacterModule,
    CombatModule,
    RealmModule,
    MapModule,
    NpcModule,
    WorldModule,
    PersistenceModule,
    ProgressionModule,
    MovementModule,
    SkillModule,
  ],
  providers: [GameGateway, CharacterRosterGateway, SessionClaimExecutor, SessionLifecycleService],
})
export class RealtimeModule {}
