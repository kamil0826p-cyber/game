import { Module } from '@nestjs/common';
import { RealmModule } from '../realm/realm.module.js';
import { CharacterCurrencyService } from './character-currency.service.js';
import { CharacterService } from './character.service.js';

@Module({
  imports: [RealmModule],
  providers: [CharacterService, CharacterCurrencyService],
  exports: [CharacterService, CharacterCurrencyService],
})
export class CharacterModule {}