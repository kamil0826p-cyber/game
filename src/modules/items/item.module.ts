import { Module } from '@nestjs/common';
import { CharacterModule } from '../characters/character.module.js';
import { MovementModule } from '../movement/movement.module.js';
import { NpcModule } from '../npcs/npc.module.js';
import { WorldModule } from '../world/world.module.js';
import { CraftOrderExpirationService } from './craft-order-expiration.service.js';
import { CraftOrderService } from './craft-order.service.js';
import { CraftingGateway } from './crafting.gateway.js';
import { CraftingService } from './crafting.service.js';
import { ItemCurseRuntimeService } from './item-curse-runtime.service.js';
import { ItemEconomyGateway } from './item-economy.gateway.js';
import { ItemEconomyService } from './item-economy.service.js';
import { ItemGateway } from './item.gateway.js';
import { ItemInventoryService } from './item-inventory.service.js';
import { ItemizationCatalogService } from './itemization-catalog.service.js';
import { MarketExpirationService } from './market-expiration.service.js';
import { MarketGateway } from './market.gateway.js';
import { MarketNpcBootstrapService } from './market-npc-bootstrap.service.js';
import { MarketService } from './market.service.js';
import { MerchantItemizedItemService } from './merchant-itemized-item.service.js';
import { ItemService } from './item.service.js';

@Module({
  imports: [WorldModule, MovementModule, CharacterModule, NpcModule],
  providers: [
    ItemizationCatalogService,
    ItemInventoryService,
    ItemEconomyService,
    CraftOrderService,
    CraftOrderExpirationService,
    CraftingService,
    MarketService,
    MarketExpirationService,
    MarketNpcBootstrapService,
    ItemCurseRuntimeService,
    MerchantItemizedItemService,
    { provide: ItemService, useExisting: MerchantItemizedItemService },
    ItemGateway,
    ItemEconomyGateway,
    CraftingGateway,
    MarketGateway,
  ],
  exports: [
    ItemService,
    ItemInventoryService,
    ItemEconomyService,
    CraftOrderService,
    CraftingService,
    MarketService,
    ItemizationCatalogService,
    ItemCurseRuntimeService,
  ],
})
export class ItemModule {}
