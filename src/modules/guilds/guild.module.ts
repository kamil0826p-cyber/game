import { Module } from '@nestjs/common';
import { WorldModule } from '../world/world.module.js';
import { GuildGateway } from './guild.gateway.js';
import { GuildPermissionService } from './guild-permission.service.js';
import { GuildService } from './guild.service.js';

@Module({
  imports: [WorldModule],
  providers: [GuildService, GuildPermissionService, GuildGateway],
  exports: [GuildService, GuildPermissionService],
})
export class GuildModule {}
