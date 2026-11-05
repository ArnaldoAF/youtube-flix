import { Loader2 } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, UNAUTHORIZED_EVENT } from './api';
import { Logo } from './components/Navbar';
import type { Me } from './types';

interface AuthState {
  /** On the PC: settings, deleting and yt-dlp updates are available. */
  local: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({ local: true, signOut: async () => undefined });

export const useAuth = () => useContext(AuthContext);

/** Other devices on the home network see the login page until they have a session. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.me());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => setMe((m) => (m && !m.local ? { ...m, authenticated: false } : m));
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh]);

  const signOut = useCallback(async () => {
    await api.logout();
    setMe((m) => (m ? { ...m, authenticated: false } : m));
  }, []);

  if (!me) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-white/60">
        {error ? (
          <>
            <p>Cannot reach youtube-flix: {error}</p>
            <button onClick={() => void refresh()} className="rounded bg-white/15 px-4 py-2 hover:bg-white/25">
              Try again
            </button>
          </>
        ) : (
          <Loader2 className="animate-spin" />
        )}
      </div>
    );
  }

  if (!me.authenticated) return <Login onSignedIn={refresh} />;

  return <AuthContext.Provider value={{ local: me.local, signOut }}>{children}</AuthContext.Provider>;
}

function Login({ onSignedIn }: { onSignedIn: () => Promise<void> }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      await onSignedIn();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-black to-flix-bg">
      <header className="px-4 py-6 md:px-12">
        <Logo className="text-3xl" />
      </header>
      <form onSubmit={submit} className="mx-auto mt-[10vh] w-full max-w-md rounded-md bg-black/75 px-8 py-12 md:px-14">
        <h1 className="mb-2 text-3xl font-bold">Sign in</h1>
        <p className="mb-8 text-sm text-white/60">Enter the household password set on the PC running youtube-flix.</p>
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          className="w-full rounded border border-white/30 bg-white/10 px-4 py-4 outline-none focus:border-white"
        />
        {error && <p className="mt-3 text-sm text-orange-400">{error}</p>}
        <button
          disabled={busy || !password}
          className="mt-8 flex w-full items-center justify-center gap-2 rounded bg-flix-red py-3 font-semibold hover:bg-flix-red-dark disabled:opacity-60"
        >
          {busy && <Loader2 size={18} className="animate-spin" />}
          Sign in
        </button>
      </form>
    </div>
  );
}
