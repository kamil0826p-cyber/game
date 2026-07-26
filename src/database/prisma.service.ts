import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { GameConfigService } from '../config/game-config.service.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: GameConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.values.DATABASE_URL,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      max: config.isProduction ? 20 : 10,
    });

    super({
      adapter,
      log: config.isProduction ? ['warn', 'error'] : ['warn', 'error'],
      transactionOptions: {
        maxWait: 5_000,
        timeout: 10_000,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('PostgreSQL connection established.');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
    this.logger.log('PostgreSQL connection closed.');
  }
}
