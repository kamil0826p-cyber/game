import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { DomainEventService } from '../../domain-events/domain-event.service.js';
import { ProgressionService } from '../progression/progression.service.js';
import { ItemCommerceService } from './item-service.commerce.js';

export { INVENTORY_CAPACITY } from './item-service.base.js';

@Injectable()
export class ItemService extends ItemCommerceService {
  constructor(
    prisma: PrismaService,
    domainEvents: DomainEventService,
    progression: ProgressionService,
  ) {
    super(prisma, domainEvents);
    this.progression = progression;
  }
}
