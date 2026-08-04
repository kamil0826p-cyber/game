import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { MarketService } from './market.service.js';

const MARKET_EXPIRATION_SWEEP_INTERVAL_MS = 60_000;

@Injectable()
export class MarketExpirationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MarketExpirationService.name);
  private timer: NodeJS.Timeout | undefined;
  private sweepRunning = false;

  constructor(
    private readonly market: MarketService,
    private readonly worldState: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  onModuleInit(): void {
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), MARKET_EXPIRATION_SWEEP_INTERVAL_MS);
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
      const affected = new Set<string>();
      let sellerIds: string[];
      do {
        sellerIds = await this.market.expireListings(100);
        for (const sellerId of sellerIds) affected.add(sellerId);
      } while (sellerIds.length > 0);
      for (const characterId of affected) {
        const session = this.worldState.getByCharacterId(characterId);
        if (!session) continue;
        this.publisher.emit(session.socketId, 'notification', {
          code: 'MARKET_LISTING_EXPIRED',
          message:
            session.locale === 'pl'
              ? 'Jedna lub więcej ofert rynkowych wygasła. Przedmioty wróciły do plecaka albo kolejki nagród.'
              : 'One or more market listings expired. The items returned to your backpack or rewards queue.',
        });
      }
    } catch (error) {
      this.logger.error(
        'Market listing expiration sweep failed.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.sweepRunning = false;
    }
  }
}
