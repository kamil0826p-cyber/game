import { Module } from '@nestjs/common';
import { WorldModule } from '../modules/world/world.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [WorldModule],
  controllers: [HealthController],
})
export class HealthModule {}
