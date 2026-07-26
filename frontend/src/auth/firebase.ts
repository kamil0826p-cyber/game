import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  setPersistence,
  type Auth,
} from 'firebase/auth';
import { runtimeConfig } from '../config/runtime';

let authInstance: Auth | undefined;
let emulatorConnected = false;

export async function getFirebaseAuth(): Promise<Auth> {
  if (runtimeConfig.validationErrors.length > 0) {
    throw new Error(runtimeConfig.validationErrors.join(' '));
  }
  if (authInstance) {
    return authInstance;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(runtimeConfig.firebase);
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);

  if (runtimeConfig.enableAuthEmulator && !emulatorConnected) {
    connectAuthEmulator(auth, runtimeConfig.authEmulatorUrl, {
      disableWarnings: true,
    });
    emulatorConnected = true;
  }

  authInstance = auth;
  return auth;
}
