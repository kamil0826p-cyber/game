import { Module } from '@nestjs/common';
import { CombatOccupancyService } from './combat-occupancy.service.js';

@Module({
  providers: [CombatOccupancyService],
  exports: [CombatOccupancyService],
})
export class CombatOccupancyModule {}
