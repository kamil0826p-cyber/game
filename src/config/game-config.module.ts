import { Global, Module } from '@nestjs/common';
import { GameConfigService } from './game-config.service.js';

@Global()
@Module({
  providers: [GameConfigService],
  exports: [GameConfigService],
})
export class GameConfigModule {}
