import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { CraftOrderService } from './craft-order.service.js';

const EXPIRATION_SWEEP_INTERVAL_MS = 60_000;

@Injectable()
export class CraftOrderExpirationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CraftOrderExpirationService.name);
  private timer: NodeJS.Timeout | undefined;
  private sweepRunning = false;

  constructor(private readonly craftOrders: CraftOrderService) {}

  onModuleInit(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), EXPIRATION_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async sweep(): Promise<void> {
    if (this.sweepRunning) return;
    this.sweepRunning = true;
    try {
      let expired: number;
      do {
        expired = await this.craftOrders.expireOrders(100);
      } while (expired === 100);
    } catch (error) {
      this.logger.error(
        'Craft order expiration sweep failed.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.sweepRunning = false;
    }
  }
}
