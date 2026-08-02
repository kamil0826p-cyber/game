import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { GroupService } from '../groups/group.service.js';
import { GuildPermissionService } from '../guilds/guild-permission.service.js';
import { ItemInventoryService } from '../items/item-inventory.service.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { SocialGuildService } from './social.service.guild.js';

@Injectable()
export class SocialService extends SocialGuildService {
  constructor(
    prisma: PrismaService,
    groups: GroupService,
    items: ItemInventoryService,
    permissions: GuildPermissionService,
    world: WorldStateService,
    publisher: WorldEventsPublisher,
  ) {
    super(prisma, groups, items, permissions, world, publisher);
  }
}
