import { Module } from '@nestjs/common';
import { MovementModule } from '../movement/movement.module.js';
import { WorldModule } from '../world/world.module.js';
import { SkillGateway } from './skill.gateway.js';
import { SkillService } from './skill.service.js';

@Module({
  imports: [WorldModule, MovementModule],
  providers: [SkillService, SkillGateway],
  exports: [SkillService],
})
export class SkillModule {}
