import { Module } from '@nestjs/common';
import { RealmService } from './realm.service.js';

@Module({
  providers: [RealmService],
  exports: [RealmService],
})
export class RealmModule {}
