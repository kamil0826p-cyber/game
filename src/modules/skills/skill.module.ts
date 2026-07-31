import { Module } from '@nestjs/common';
import { CharacterModule } from '../characters/character.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { WorldModule } from '../world/world.module.js';
import { SkillGateway } from './skill.gateway.js';
import { SkillService } from './skill.service.js';

@Module({
  imports: [CharacterModule, WorldModule, MovementModule],
  providers: [SkillService, SkillGateway],
  exports: [SkillService],
})
export class SkillModule {}
