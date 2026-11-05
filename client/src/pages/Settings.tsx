import { CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { HomeNetwork } from '../components/HomeNetwork';
import { formatBytes } from '../format';
import type { Settings as SettingsT, SystemInfo, ToolInfo } from '../types';

const HEIGHTS = [360, 480, 720, 1080, 1440, 2160] as const;
const BROWSERS = ['', 'chrome', 'edge', 'firefox', 'brave', 'opera', 'vivaldi', 'chromium'];

export function Settings() {
  const [settings, setSettings] = useState<SettingsT | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    api.settings().then(setSettings).catch((e: Error) => setMessage({ ok: false, text: e.message }));
    api.system().then(setSystem).catch(() => undefined);
  }, []);

  if (!settings) return <div className="pt-40 text-center text-white/50">Loading…</div>;

  const set = <K extends keyof SettingsT>(key: K, value: SettingsT[K]) => setSettings({ ...settings, [key]: value });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      setSettings(await api.saveSettings(settings));
      setMessage({ ok: true, text: 'Settings saved' });
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    }
  };

  const updateYtDlp = async () => {
    setUpdating(true);
    try {
      const { output } = await api.updateYtDlp();
      setMessage({ ok: true, text: output.split('\n').pop() ?? 'Updated' });
      setSystem(await api.system());
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
    } finally {
      setUpdating(false);
    }
  };

  const field = 'w-full rounded border border-white/20 bg-black/60 px-3 py-2 text-sm outline-none focus:border-white/60';

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-24">
      <h1 className="text-3xl font-black">Settings</h1>
      {message && (
        <p className={`mt-4 rounded px-4 py-2 text-sm ${message.ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-flix-red/20 text-red-200'}`}>
          {message.text}
        </p>
      )}

      <form onSubmit={save} className="mt-8 space-y-5">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={settings.autoDownload} onChange={(e) => set('autoDownload', e.target.checked)} className="accent-flix-red" />
          Download automatically when a title is added (series: first episode only)
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-white/60">Download folder</span>
          <input value={settings.mediaDir} onChange={(e) => set('mediaDir', e.target.value)} className={field} />
          <span className="mt-1 block text-xs text-white/40">Applies to new downloads. Existing files stay where they are.</span>
        </label>
        <div className="grid grid-cols-2 gap-4">
          <label className="block text-sm">
            <span className="mb-1 block text-white/60">Maximum quality</span>
            <select value={settings.maxHeight} onChange={(e) => set('maxHeight', Number(e.target.value) as SettingsT['maxHeight'])} className={field}>
              {HEIGHTS.map((h) => (
                <option key={h} value={h}>
                  {h === 2160 ? '4K (2160p)' : `${h}p`}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-white/60">Simultaneous downloads</span>
            <select value={settings.concurrency} onChange={(e) => set('concurrency', Number(e.target.value))} className={field}>
              {[1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-white/60">Use cookies from browser (for private or age-restricted videos)</span>
          <select value={settings.cookiesFromBrowser} onChange={(e) => set('cookiesFromBrowser', e.target.value)} className={field}>
            {BROWSERS.map((b) => (
              <option key={b} value={b}>
                {b || 'Off'}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded bg-white px-6 py-2 text-sm font-semibold text-black hover:bg-white/80">Save</button>
      </form>

      <HomeNetwork settings={settings} onSaved={setSettings} />

      <section className="mt-12">
        <h2 className="mb-3 text-lg font-semibold">System</h2>
        {!system ? (
          <p className="text-sm text-white/50">Checking tools…</p>
        ) : (
          <div className="space-y-2 rounded bg-flix-panel p-4 text-sm">
            <ToolLine name="yt-dlp" tool={system.tools.ytDlp} />
            <ToolLine name="ffmpeg" tool={system.tools.ffmpeg} />
            <p className="text-white/60">
              Library: {system.library.files} file(s), {formatBytes(system.library.bytes) || '0 B'}
            </p>
            <button
              onClick={updateYtDlp}
              disabled={updating}
              className="mt-2 flex items-center gap-2 rounded bg-white/15 px-4 py-2 hover:bg-white/25 disabled:opacity-50"
            >
              {updating && <Loader2 size={16} className="animate-spin" />}
              Update yt-dlp
            </button>
            <p className="text-xs text-white/40">If imports or downloads start failing, YouTube probably changed something — update yt-dlp first.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ToolLine({ name, tool }: { name: string; tool: ToolInfo }) {
  return (
    <p className="flex items-center gap-2">
      {tool.ok ? <CheckCircle2 size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-flix-red" />}
      <span className="font-semibold">{name}</span>
      <span className="truncate text-white/50">{tool.ok ? tool.version : 'not found'}</span>
    </p>
  );
}
