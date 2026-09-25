import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '@/api/client';
import type { PublicUser } from '@/api/types';
import { googleIdToken } from '@/native/googleSignIn';

/**
 * Who is signed in.
 *
 * The token lives in SecureStore - the iOS Keychain / Android Keystore - not
 * AsyncStorage, which is a plain unencrypted file anyone with a rooted phone
 * or a device backup can read.
 */
const TOKEN_KEY = 'fareground.token';
const USER_KEY = 'fareground.user';

interface Session {
  /** null while we are still reading the keychain on launch. */
  ready: boolean;
  token: string | null;
  user: PublicUser | null;
  signIn(email: string, password: string): Promise<void>;
  /**
   * Create an account. Resolves with the new TOKEN, because React state has
   * not updated by the time this returns and the caller may need to act as
   * the new account straight away (redeeming an invite code, for instance).
   */
  signUp(username: string, email: string, password: string): Promise<string>;
  /** Google's account picker, then our server. Resolves true for a new account. */
  signInWithGoogle(): Promise<boolean>;
  signOut(): Promise<void>;
}

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [t, u] = await Promise.all([
          SecureStore.getItemAsync(TOKEN_KEY),
          SecureStore.getItemAsync(USER_KEY),
        ]);
        setToken(t);
        setUser(u ? (JSON.parse(u) as PublicUser) : null);
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const persist = useCallback(async (t: string, u: PublicUser) => {
    await SecureStore.setItemAsync(TOKEN_KEY, t);
    await SecureStore.setItemAsync(USER_KEY, JSON.stringify(u));
    setToken(t);
    setUser(u);
  }, []);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const result = await api.login(email, password);
      await persist(result.token, result.user);
    },
    [persist],
  );

  const signUp = useCallback(
    async (username: string, email: string, password: string) => {
      const result = await api.register(username, email, password);
      await persist(result.token, result.user);
      return result.token;
    },
    [persist],
  );

  const signInWithGoogle = useCallback(async () => {
    const idToken = await googleIdToken();
    const result = await api.google(idToken);
    await persist(result.token, result.user);
    return result.created === true;
  }, [persist]);

  const signOut = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ ready, token, user, signIn, signUp, signInWithGoogle, signOut }),
    [ready, token, user, signIn, signUp, signInWithGoogle, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): Session {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used inside <SessionProvider>.');
  return ctx;
}
