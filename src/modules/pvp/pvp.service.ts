import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service.js';
import { PvpServiceReplay } from './pvp.service.replay.js';

export * from './pvp.service.shared.js';

@Injectable()
export class PvpService extends PvpServiceReplay {
  constructor(prisma: PrismaService) {
    super(prisma);
  }
}
