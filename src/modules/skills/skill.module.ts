import { Module } from '@nestjs/common';
import { MovementModule } from '../movement/movement.module.js';
import { WorldModule } from '../world/world.module.js';
import { ItemizedSkillService } from './itemized-skill.service.js';
import { SkillGateway } from './skill.gateway.js';
import { SkillService } from './skill.service.js';

@Module({
  imports: [WorldModule, MovementModule],
  providers: [
    ItemizedSkillService,
    { provide: SkillService, useExisting: ItemizedSkillService },
    SkillGateway,
  ],
  exports: [SkillService],
})
export class SkillModule {}
