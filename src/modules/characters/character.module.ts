import { Module } from '@nestjs/common';
import { RealmModule } from '../realm/realm.module.js';
import { CharacterCurrencyService } from './character-currency.service.js';
import { CharacterService } from './character.service.js';
import { ProgressionService } from './progression.service.js';

@Module({
  imports: [RealmModule],
  providers: [ProgressionService, CharacterService, CharacterCurrencyService],
  exports: [ProgressionService, CharacterService, CharacterCurrencyService],
})
export class CharacterModule {}
