import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { WorldEventsPublisher } from '../world/world-events.publisher.js';
import { WorldStateService } from '../world/world-state.service.js';
import { RewardClaimsService } from './reward-claims.service.js';

export const REWARD_CLAIM_EXPIRATION_SWEEP_INTERVAL_MS = 60_000;

@Injectable()
export class RewardClaimExpirationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RewardClaimExpirationService.name);
  private timer: NodeJS.Timeout | undefined;
  private sweepRunning = false;

  constructor(
    private readonly claims: RewardClaimsService,
    private readonly worldState: WorldStateService,
    private readonly publisher: WorldEventsPublisher,
  ) {}

  onModuleInit(): void {
    void this.sweep();
    this.timer = setInterval(
      () => void this.sweep(),
      REWARD_CLAIM_EXPIRATION_SWEEP_INTERVAL_MS,
    );
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
      let expiredCount: number;
      do {
        const result = await this.claims.expireOpenClaims(100);
        expiredCount = result.expiredCount;
        for (const characterId of result.characterIds) affected.add(characterId);
      } while (expiredCount > 0);

      for (const characterId of affected) {
        const session = this.worldState.getByCharacterId(characterId);
        if (!session) continue;
        this.publisher.emit(session.socketId, 'notification', {
          code: 'REWARD_CLAIM_EXPIRED',
          message:
            session.locale === 'pl'
              ? 'Jedna lub więcej nieodebranych nagród wygasła.'
              : 'One or more unclaimed rewards expired.',
        });
      }
    } catch (error) {
      this.logger.error(
        'Reward claim expiration sweep failed.',
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.sweepRunning = false;
    }
  }
}
