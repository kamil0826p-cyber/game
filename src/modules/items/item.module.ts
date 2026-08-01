import { Module } from '@nestjs/common';
import { CharacterModule } from '../characters/character.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { WorldModule } from '../world/world.module.js';
import { CanonicalItemService } from './canonical-item.service.js';
import { ItemGateway } from './item.gateway.js';
import { ItemService } from './item.service.js';

@Module({
  imports: [WorldModule, MovementModule, CharacterModule],
  providers: [
    { provide: ItemService, useClass: CanonicalItemService },
    ItemGateway,
  ],
  exports: [ItemService],
})
export class ItemModule {}
