import { Wifi } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { NetworkInfo, Settings } from '../types';

type Message = { ok: boolean; text: string } | null;

/** PC-only: household password, the on/off switch, and the addresses to type on other devices. */
export function HomeNetwork({ settings, onSaved }: { settings: Settings; onSaved: (s: Settings) => void }) {
  const [hasPassword, setHasPassword] = useState(false);
  const [info, setInfo] = useState<NetworkInfo | null>(null);
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [message, setMessage] = useState<Message>(null);
  const isOn = settings.network === 'home';

  useEffect(() => {
    api.me().then((m) => setHasPassword(m.hasPassword)).catch(() => undefined);
    api.network().then(setInfo).catch(() => undefined);
  }, []);

  const attempt = async (fn: () => Promise<void>) => {
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  };

  const savePassword = (e: FormEvent) => {
    e.preventDefault();
    if (password !== repeat) return setMessage({ ok: false, text: 'The two passwords are different' });
    void attempt(async () => {
      await api.setPassword(password);
      setHasPassword(true);
      setPassword('');
      setRepeat('');
      setMessage({ ok: true, text: hasPassword ? 'Password changed. Other devices must sign in again.' : 'Password set' });
    });
  };

  const toggle = () =>
    attempt(async () => {
      onSaved(await api.saveSettings({ network: isOn ? 'local' : 'home' }));
      setMessage({ ok: true, text: isOn ? 'Home network access is off' : 'Home network access is on' });
    });

  const signOutAll = () => {
    if (!confirm('Sign out every other device? They will need the password again.')) return;
    void attempt(async () => {
      await api.signOutAll();
      setMessage({ ok: true, text: 'All other devices were signed out' });
    });
  };

  const field = 'w-full rounded border border-white/20 bg-black/60 px-3 py-2 text-sm outline-none focus:border-white/60';

  return (
    <section className="mt-12">
      <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold">
        <Wifi size={20} /> Home network
      </h2>
      <div className="space-y-5 rounded bg-flix-panel p-4 text-sm">
        <p className="text-white/60">
          Watch on your phone, TV or other computers on the same Wi-Fi. They sign in with a household password and
          can watch, add and edit titles. Settings and deleting stay on this PC.
        </p>
        {message && (
          <p className={`rounded px-3 py-2 ${message.ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-flix-red/20 text-red-200'}`}>
            {message.text}
          </p>
        )}

        <form onSubmit={savePassword} className="space-y-2">
          <span className="block text-white/60">{hasPassword ? 'Change the household password' : 'Set a household password'}</span>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <input type="password" autoComplete="new-password" placeholder="New password (8+ characters)" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
            <input type="password" autoComplete="new-password" placeholder="Repeat it" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={field} />
            <button disabled={!password || !repeat} className="rounded bg-white/15 px-4 py-2 hover:bg-white/25 disabled:opacity-40">
              Save password
            </button>
          </div>
        </form>

        <label className={`flex items-center gap-3 ${hasPassword ? '' : 'opacity-50'}`}>
          <button
            type="button"
            role="switch"
            aria-checked={isOn}
            disabled={!hasPassword}
            onClick={() => void toggle()}
            className={`relative h-6 w-11 shrink-0 rounded-full transition ${isOn ? 'bg-flix-red' : 'bg-white/25'}`}
          >
            <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${isOn ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
          <span>{isOn ? 'Other devices can connect' : 'Only this PC can use youtube-flix'}</span>
          {!hasPassword && <span className="text-xs text-white/50">(set a password first)</span>}
        </label>

        {isOn && info && (
          <div>
            <p className="mb-1 text-white/60">On the other device, open:</p>
            <ul className="space-y-1">
              {info.addresses.map((a) => (
                <li key={a.url} className="flex flex-wrap items-baseline gap-2">
                  <code className="rounded bg-black/50 px-2 py-0.5 text-base text-white">{a.url}</code>
                  <span className="text-xs text-white/40">{a.label}</span>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-white/40">
              If Windows asks whether to allow Node.js through the firewall, allow it on <b>Private networks</b> only.
            </p>
          </div>
        )}

        {hasPassword && (
          <button type="button" onClick={signOutAll} className="rounded bg-white/15 px-4 py-2 hover:bg-white/25">
            Sign out all other devices
          </button>
        )}
      </div>
    </section>
  );
}
