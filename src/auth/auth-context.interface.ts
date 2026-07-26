export interface AuthContext {
  firebaseUid: string;
  email?: string;
  displayName?: string;
  tokenIssuedAt: number;
}
