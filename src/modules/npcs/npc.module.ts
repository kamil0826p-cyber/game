import { Module } from '@nestjs/common';
import { QuestModule } from '../quests/quest.module.js';
import { NpcService } from './npc.service.js';

@Module({ imports: [QuestModule], providers: [NpcService], exports: [NpcService] })
export class NpcModule {}
