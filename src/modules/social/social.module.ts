import { Module } from '@nestjs/common';
import { GroupModule } from '../groups/group.module.js';
import { GuildModule } from '../guilds/guild.module.js';
import { ItemModule } from '../items/item.module.js';
import { WorldModule } from '../world/world.module.js';
import { SocialGateway } from './social.gateway.js';
import { SocialService } from './social.service.js';

@Module({
  imports: [WorldModule, GroupModule, GuildModule, ItemModule],
  providers: [SocialService, SocialGateway],
  exports: [SocialService],
})
export class SocialModule {}
