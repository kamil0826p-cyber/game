import { Module } from '@nestjs/common';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import { MapModule } from '../maps/map.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { WorldModule } from '../world/world.module.js';
import { MovementCoordinatorService } from './movement-coordinator.service.js';
import { MovementService } from './movement.service.js';
import { PathMovementService } from './path-movement.service.js';
import { PathfindingService } from './pathfinding.service.js';

@Module({
  imports: [MapModule, WorldModule, PersistenceModule],
  providers: [
    KeyedSerialExecutor,
    PathfindingService,
    MovementService,
    PathMovementService,
    MovementCoordinatorService,
  ],
  exports: [MovementCoordinatorService, MovementService],
})
export class MovementModule {}
