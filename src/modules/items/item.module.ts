import { Module } from '@nestjs/common';
import { CharacterModule } from '../characters/character.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { WorldModule } from '../world/world.module.js';
import { ItemEconomyGateway } from './item-economy.gateway.js';
import { ItemEconomyService } from './item-economy.service.js';
import { ItemGateway } from './item.gateway.js';
import { ItemInventoryService } from './item-inventory.service.js';
import { ItemizationCatalogService } from './itemization-catalog.service.js';
import { MerchantItemizedItemService } from './merchant-itemized-item.service.js';
import { ItemService } from './item.service.js';

@Module({
  imports: [WorldModule, MovementModule, CharacterModule],
  providers: [
    ItemizationCatalogService,
    ItemInventoryService,
    ItemEconomyService,
    MerchantItemizedItemService,
    { provide: ItemService, useExisting: MerchantItemizedItemService },
    ItemGateway,
    ItemEconomyGateway,
  ],
  exports: [
    ItemService,
    ItemInventoryService,
    ItemEconomyService,
    ItemizationCatalogService,
  ],
})
export class ItemModule {}
