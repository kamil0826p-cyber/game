import { Module } from '@nestjs/common';
import { LocalizationModule } from '../../i18n/localization.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { PersistenceModule } from '../persistence/persistence.module.js';
import { WorldModule } from '../world/world.module.js';
import { ProgressionGateway } from './progression.gateway.js';
import { ProgressionService } from './progression.service.js';

@Module({
  imports: [LocalizationModule, MovementModule, PersistenceModule, WorldModule],
  providers: [ProgressionService, ProgressionGateway],
  exports: [ProgressionService],
})
export class ProgressionModule {}
