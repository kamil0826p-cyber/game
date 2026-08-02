import { Module } from '@nestjs/common';
import { MovementModule } from '../movement/movement.module.js';
import { WorldModule } from '../world/world.module.js';
import { GuildGateway } from './guild.gateway.js';
import { GuildService } from './guild.service.js';

@Module({
  imports: [WorldModule, MovementModule],
  providers: [GuildService, GuildGateway],
  exports: [GuildService],
})
export class GuildModule {}
