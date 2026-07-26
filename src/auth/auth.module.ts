import { Global, Module } from '@nestjs/common';
import { FirebaseAuthService } from './firebase-auth.service.js';
import { FirebaseSocketAuthMiddleware } from './firebase-socket-auth.middleware.js';

@Global()
@Module({
  providers: [FirebaseAuthService, FirebaseSocketAuthMiddleware],
  exports: [FirebaseAuthService, FirebaseSocketAuthMiddleware],
})
export class AuthModule {}
