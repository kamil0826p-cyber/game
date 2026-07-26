export interface RuntimeConfig {
  gameServerUrl: string;
  socketPath: string;
  enableAuthEmulator: boolean;
  authEmulatorUrl: string;
  firebase: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
  };
  validationErrors: string[];
}

const read = (name: keyof ImportMetaEnv): string => import.meta.env[name]?.trim() ?? '';

const firebase = {
  apiKey: read('VITE_FIREBASE_API_KEY'),
  authDomain: read('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: read('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: read('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: read('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: read('VITE_FIREBASE_APP_ID'),
};

const requiredFirebaseFields: Array<[keyof typeof firebase, string]> = [
  ['apiKey', 'VITE_FIREBASE_API_KEY'],
  ['authDomain', 'VITE_FIREBASE_AUTH_DOMAIN'],
  ['projectId', 'VITE_FIREBASE_PROJECT_ID'],
  ['appId', 'VITE_FIREBASE_APP_ID'],
];

const validationErrors = requiredFirebaseFields
  .filter(([key]) => firebase[key].length === 0)
  .map(([, environmentName]) => `${environmentName} is required.`);

export const runtimeConfig: RuntimeConfig = {
  gameServerUrl: read('VITE_GAME_SERVER_URL') || window.location.origin,
  socketPath: read('VITE_SOCKET_PATH') || '/socket.io',
  enableAuthEmulator: read('VITE_ENABLE_AUTH_EMULATOR').toLowerCase() === 'true',
  authEmulatorUrl:
    read('VITE_FIREBASE_AUTH_EMULATOR_URL') || 'http://127.0.0.1:9099',
  firebase,
  validationErrors,
};
