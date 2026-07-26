import { Injectable, Logger } from '@nestjs/common';
import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App,
  type ServiceAccount,
} from 'firebase-admin/app';
import { getAuth, type Auth, type DecodedIdToken } from 'firebase-admin/auth';
import { GameConfigService } from '../config/game-config.service.js';
import type { AuthContext } from './auth-context.interface.js';

@Injectable()
export class FirebaseAuthService {
  private readonly logger = new Logger(FirebaseAuthService.name);
  private readonly app: App;
  private readonly auth: Auth;

  constructor(private readonly config: GameConfigService) {
    this.app = getApps()[0] ?? initializeApp(this.buildFirebaseOptions());
    this.auth = getAuth(this.app);
  }

  async verifyIdToken(idToken: string): Promise<AuthContext> {
    const decoded = await this.auth.verifyIdToken(
      idToken,
      this.config.values.FIREBASE_CHECK_REVOKED,
    );
    return this.toAuthContext(decoded);
  }

  private buildFirebaseOptions(): Parameters<typeof initializeApp>[0] {
    const serviceAccount = this.readServiceAccount();
    if (serviceAccount) {
      this.logger.log('Firebase Admin uses an explicit service account credential.');
      return {
        credential: cert(serviceAccount),
        projectId: this.config.values.FIREBASE_PROJECT_ID ?? serviceAccount.projectId,
      };
    }

    this.logger.log('Firebase Admin uses Application Default Credentials.');
    return {
      credential: applicationDefault(),
      projectId: this.config.values.FIREBASE_PROJECT_ID,
    };
  }

  private readServiceAccount(): ServiceAccount | undefined {
    const rawJson = this.config.values.FIREBASE_SERVICE_ACCOUNT_JSON;
    const base64Json = this.config.values.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!rawJson && !base64Json) {
      return undefined;
    }

    const serialized = rawJson ?? Buffer.from(base64Json!, 'base64').toString('utf8');
    const parsed = JSON.parse(serialized) as {
      projectId?: string;
      clientEmail?: string;
      privateKey?: string;
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };

    const projectId = parsed.projectId ?? parsed.project_id;
    const clientEmail = parsed.clientEmail ?? parsed.client_email;
    const privateKey = parsed.privateKey ?? parsed.private_key;
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        'Firebase service account JSON must include project_id, client_email, and private_key.',
      );
    }

    return {
      projectId,
      clientEmail,
      privateKey: privateKey.replaceAll('\\n', '\n'),
    };
  }

  private toAuthContext(decoded: DecodedIdToken): AuthContext {
    return {
      firebaseUid: decoded.uid,
      email: decoded.email,
      displayName: decoded.name,
      tokenIssuedAt: decoded.iat,
    };
  }
}
