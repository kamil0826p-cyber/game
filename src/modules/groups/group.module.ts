import { Module } from '@nestjs/common';
import { WorldModule } from '../world/world.module.js';
import { GroupGateway } from './group.gateway.js';
import { GroupService } from './group.service.js';

@Module({
  imports: [WorldModule],
  providers: [GroupService, GroupGateway],
  exports: [GroupService],
})
export class GroupModule {}
