import { Module } from '@nestjs/common';
import { MovementModule } from '../movement/movement.module.js';
import { WorldModule } from '../world/world.module.js';
import { NpcGateway } from './npc.gateway.js';
import { NpcModule } from './npc.module.js';

@Module({
  imports: [NpcModule, MovementModule, WorldModule],
  providers: [NpcGateway],
})
export class NpcInteractionModule {}
