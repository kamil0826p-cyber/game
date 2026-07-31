import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { CONTENT_SCHEMA_VERSION } from './current-content.js';
import { ContentDeploymentService } from './content-deployment.service.js';

@Injectable()
export class ContentReadinessService implements OnModuleInit {
  private readonly logger = new Logger(ContentReadinessService.name);
  constructor(private readonly config: GameConfigService, private readonly content: ContentDeploymentService) {}

  async onModuleInit(): Promise<void> {
    if (!this.config.values.CONTENT_READINESS_CHECK) {
      this.logger.warn('Content readiness check is disabled.');
      return;
    }
    const release = await this.content.active();
    if (!release) throw new Error('No active content release. Run npm run db:prepare before starting the server.');
    if (release.version !== this.config.values.GAME_CONTENT_VERSION) throw new Error(`Active content ${release.version} does not match required ${this.config.values.GAME_CONTENT_VERSION}.`);
    if (release.schemaVersion !== CONTENT_SCHEMA_VERSION) throw new Error(`Active content schema ${release.schemaVersion} is incompatible with runtime schema ${CONTENT_SCHEMA_VERSION}.`);
    this.logger.log(`Content release ${release.version} (${release.sourceHash.slice(0, 12)}) is ready.`);
  }
}
