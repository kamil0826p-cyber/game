import { Module } from '@nestjs/common';
import { PvpService } from './pvp.service.js';

@Module({
  providers: [PvpService],
  exports: [PvpService],
})
export class PvpModule {}
