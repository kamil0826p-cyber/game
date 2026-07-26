import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { runtimeConfig } from '../config/runtime';
import { getFirebaseAuth } from './firebase';

interface RegisterInput {
  displayName: string;
  email: string;
  password: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  error: string | null;
  configurationErrors: string[];
  signIn: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const messageFromUnknownError = (error: unknown): string =>
  error instanceof Error ? error.message : 'Authentication failed.';

export function AuthProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (runtimeConfig.validationErrors.length > 0) {
      setLoading(false);
      return;
    }

    let unsubscribe: () => void = () => undefined;
    let active = true;
    void getFirebaseAuth()
      .then((auth) => {
        if (!active) {
          return;
        }
        unsubscribe = onIdTokenChanged(auth, (nextUser) => {
          setUser(nextUser);
          setLoading(false);
        });
      })
      .catch((caught: unknown) => {
        if (active) {
          setError(messageFromUnknownError(caught));
          setLoading(false);
        }
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const auth = await getFirebaseAuth();
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (caught) {
      const message = messageFromUnknownError(caught);
      setError(message);
      throw caught;
    }
  }, []);

  const register = useCallback(async ({ displayName, email, password }: RegisterInput) => {
    setError(null);
    try {
      const auth = await getFirebaseAuth();
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(credential.user, { displayName: displayName.trim() });
      await credential.user.getIdToken(true);
      setUser(credential.user);
    } catch (caught) {
      const message = messageFromUnknownError(caught);
      setError(message);
      throw caught;
    }
  }, []);

  const signOut = useCallback(async () => {
    setError(null);
    const auth = await getFirebaseAuth();
    await firebaseSignOut(auth);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value = useMemo(
    () => ({
      user,
      loading,
      error,
      configurationErrors: runtimeConfig.validationErrors,
      signIn,
      register,
      signOut,
      clearError,
    }),
    [clearError, error, loading, register, signIn, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.');
  }
  return context;
}
