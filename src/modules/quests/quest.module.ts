import { Module } from '@nestjs/common';
import { WorldModule } from '../world/world.module.js';
import { QuestGateway } from './quest.gateway.js';
import { QuestService } from './quest.service.js';

@Module({ imports: [WorldModule], providers: [QuestService, QuestGateway], exports: [QuestService] })
export class QuestModule {}
