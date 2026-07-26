import { Module } from '@nestjs/common';
import { KeyedSerialExecutor } from '../../common/utils/keyed-serial-executor.js';
import { WorldModule } from '../world/world.module.js';
import { AutosaveService } from './autosave.service.js';
import { PlayerPersistenceService } from './player-persistence.service.js';

@Module({
  imports: [WorldModule],
  providers: [KeyedSerialExecutor, PlayerPersistenceService, AutosaveService],
  exports: [PlayerPersistenceService, AutosaveService],
})
export class PersistenceModule {}
