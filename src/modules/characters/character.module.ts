import { Module } from '@nestjs/common';
import { RealmModule } from '../realm/realm.module.js';
import { CharacterCurrencyService } from './character-currency.service.js';
import { CharacterService } from './character.service.js';
import { ItemizedCharacterProgressionService } from './progression/itemized-character-progression.service.js';
import { CharacterProgressionService } from './progression/character-progression.service.js';

@Module({
  imports: [RealmModule],
  providers: [
    CharacterService,
    CharacterCurrencyService,
    ItemizedCharacterProgressionService,
    {
      provide: CharacterProgressionService,
      useExisting: ItemizedCharacterProgressionService,
    },
  ],
  exports: [CharacterService, CharacterCurrencyService, CharacterProgressionService],
})
export class CharacterModule {}
