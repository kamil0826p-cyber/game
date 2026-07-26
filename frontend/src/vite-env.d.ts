/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GAME_SERVER_URL?: string;
  readonly VITE_SOCKET_PATH?: string;
  readonly VITE_DEFAULT_LOCALE?: string;
  readonly VITE_ENABLE_AUTH_EMULATOR?: string;
  readonly VITE_FIREBASE_AUTH_EMULATOR_URL?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
