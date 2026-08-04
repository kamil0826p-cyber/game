import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { CraftOrderService } from './craft-order.service.js';

const EXPIRATION_SWEEP_INTERVAL_MS = 60_000;

@Injectable()
export class CraftOrderExpirationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CraftOrderExpirationService.name);
  private timer: NodeJS.Timeout | undefined;
  private sweepRunning = false;

  constructor(
    private readonly craftOrders: CraftOrderService,
    private readonly prisma: PrismaService,
    private readonly worldState: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

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
      let totalExpired = 0;
      do {
        expired = await this.craftOrders.expireOrders(100);
        totalExpired += expired;
      } while (expired === 100);
      if (totalExpired > 0) await this.syncOnlineSilver();
    } catch (error) {
      this.logger.error(
        'Craft order expiration sweep failed.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.sweepRunning = false;
    }
  }

  private async syncOnlineSilver(): Promise<void> {
    const sessions = this.worldState.listSessions();
    if (sessions.length === 0) return;
    const balances = await this.prisma.character.findMany({
      where: { id: { in: sessions.map((session) => session.characterId) } },
      select: { id: true, silver: true },
    });
    const silverByCharacterId = new Map(
      balances.map((character) => [character.id, character.silver]),
    );
    for (const session of sessions) {
      const silver = silverByCharacterId.get(session.characterId);
      if (silver === undefined || silver === session.silver) continue;
      const previous = session.silver;
      session.silver = silver;
      session.stateRevision += 1;
      session.dirty = true;
      this.publisher.emit(session.socketId, 'character:currencyUpdated', {
        characterId: session.characterId,
        currency: 'SILVER',
        amount: silver - previous,
        balance: silver,
      });
    }
  }
}
