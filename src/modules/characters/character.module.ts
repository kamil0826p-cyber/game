import { Module } from '@nestjs/common';
import { RealmModule } from '../realm/realm.module.js';
import { CharacterService } from './character.service.js';

@Module({
  imports: [RealmModule],
  providers: [CharacterService],
  exports: [CharacterService],
})
export class CharacterModule {}
