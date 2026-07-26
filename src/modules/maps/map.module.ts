import { Module } from '@nestjs/common';
import { RealmModule } from '../realm/realm.module.js';
import { MapService } from './map.service.js';

@Module({
  imports: [RealmModule],
  providers: [MapService],
  exports: [MapService],
})
export class MapModule {}
