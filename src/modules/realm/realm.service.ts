import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GAME_ERROR_CODES, GameError } from '../../common/errors/game.error.js';
import { GameConfigService } from '../../config/game-config.service.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { CurrentRealm } from './realm.types.js';

@Injectable()
export class RealmService implements OnModuleInit {
  private readonly logger = new Logger(RealmService.name);
  private currentRealm?: CurrentRealm;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: GameConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const realm = await this.getCurrentRealm();
    this.logger.log(`Loaded realm ${realm.slug} (${realm.id}).`);
  }

  async getCurrentRealm(): Promise<CurrentRealm> {
    if (this.currentRealm) {
      return this.currentRealm;
    }

    const realm = await this.prisma.realm.findUnique({
      where: { slug: this.config.values.GAME_REALM_SLUG },
      select: {
        id: true,
        slug: true,
        name: true,
        isActive: true,
        defaultMapId: true,
      },
    });

    if (!realm?.isActive || !realm.defaultMapId) {
      throw new GameError(GAME_ERROR_CODES.REALM_UNAVAILABLE, 'errors.realm.unavailable');
    }

    this.currentRealm = {
      id: realm.id,
      slug: realm.slug,
      name: realm.name,
      defaultMapId: realm.defaultMapId,
    };
    return this.currentRealm;
  }
}
