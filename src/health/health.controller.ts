import { Controller, Get } from '@nestjs/common';
import { GameConfigService } from '../config/game-config.service.js';
import { WorldStateService } from '../modules/world/world-state.service.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly config: GameConfigService,
    private readonly worldState: WorldStateService,
  ) {}

  @Get()
  getHealth(): Record<string, unknown> {
    return {
      status: 'ok',
      realm: this.config.values.GAME_REALM_SLUG,
      instanceId: this.config.values.GAME_REALM_INSTANCE_ID,
      onlinePlayers: this.worldState.count,
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
