import { Module } from '@nestjs/common';
import { WorldModule } from '../world/world.module.js';
import { AddCurrencyAdminCommand } from './add-currency.admin-command.js';
import { AdminCommandService } from './admin-command.service.js';
import { AdminGateway } from './admin.gateway.js';

@Module({
  imports: [WorldModule],
  providers: [AddCurrencyAdminCommand, AdminCommandService, AdminGateway],
})
export class AdminModule {}
