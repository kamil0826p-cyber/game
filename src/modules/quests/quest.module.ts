import { Module } from '@nestjs/common';
import { CharacterModule } from '../characters/character.module.js';
import { WorldModule } from '../world/world.module.js';
import { QuestGateway } from './quest.gateway.js';
import { QuestService } from './quest.service.js';

@Module({
  imports: [CharacterModule, WorldModule],
  providers: [QuestService, QuestGateway],
  exports: [QuestService],
})
export class QuestModule {}
