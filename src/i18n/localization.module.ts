import { Global, Module } from '@nestjs/common';
import { LocalizationService } from './localization.service.js';

@Global()
@Module({
  providers: [LocalizationService],
  exports: [LocalizationService],
})
export class LocalizationModule {}
