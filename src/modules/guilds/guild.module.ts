import { Module } from '@nestjs/common';
import { WorldModule } from '../world/world.module.js';
import { GuildGateway } from './guild.gateway.js';
import { GuildService } from './guild.service.js';

@Module({
  imports: [WorldModule],
  providers: [GuildService, GuildGateway],
  exports: [GuildService],
})
export class GuildModule {}
