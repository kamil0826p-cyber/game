import { Module } from '@nestjs/common';
import { ContentDeploymentService } from './content-deployment.service.js';
import { ContentReadinessService } from './content-readiness.service.js';

@Module({
  providers: [ContentDeploymentService, ContentReadinessService],
  exports: [ContentDeploymentService],
})
export class ContentModule {}
