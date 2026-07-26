import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module.js';
import { CharacterModule } from '../characters/character.module.js';
import { MapModule } from '../maps/map.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { RealmModule } from '../realm/realm.module.js';
import { WorldModule } from '../world/world.module.js';
import { GameGateway } from './game.gateway.js';
import { SessionClaimExecutor } from './session-claim.executor.js';
import { SessionLifecycleService } from './session-lifecycle.service.js';

@Module({
  imports: [
    AuthModule,
    CharacterModule,
    RealmModule,
    MapModule,
    WorldModule,
    PersistenceModule,
    MovementModule,
  ],
  providers: [GameGateway, SessionClaimExecutor, SessionLifecycleService],
})
export class RealtimeModule {}
