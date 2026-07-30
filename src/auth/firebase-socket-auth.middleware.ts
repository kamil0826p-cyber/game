import { Injectable, Logger } from '@nestjs/common';
import type { ExtendedError } from 'socket.io';
import { configureGameSocketListenerBudget } from '../common/socket/game-socket-listener-budget.js';
import type { GameSocket } from '../contracts/socket.events.js';
import { FirebaseAuthService } from './firebase-auth.service.js';

@Injectable()
export class FirebaseSocketAuthMiddleware {
  private readonly logger = new Logger(FirebaseSocketAuthMiddleware.name);

  constructor(private readonly firebaseAuth: FirebaseAuthService) {}

  readonly authenticate = async (
    socket: GameSocket,
    next: (error?: ExtendedError) => void,
  ): Promise<void> => {
    configureGameSocketListenerBudget(socket);

    try {
      const token = this.extractToken(socket);
      if (!token) {
        next(new Error('AUTH_REQUIRED'));
        return;
      }

      socket.data.auth = await this.firebaseAuth.verifyIdToken(token);
      next();
    } catch (error) {
      this.logger.warn(
        `Rejected WebSocket authentication: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      next(new Error('AUTH_INVALID'));
    }
  };

  private extractToken(socket: GameSocket): string | undefined {
    const handshakeToken = socket.handshake.auth?.token;
    if (typeof handshakeToken === 'string' && handshakeToken.length > 0) {
      return handshakeToken.startsWith('Bearer ') ? handshakeToken.slice(7) : handshakeToken;
    }

    const authorization = socket.handshake.headers.authorization;
    if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
      return authorization.slice(7);
    }

    return undefined;
  }
}
