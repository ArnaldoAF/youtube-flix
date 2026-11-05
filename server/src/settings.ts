import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_MEDIA_DIR } from './config.js';
import type { DB } from './db.js';
import { HttpError } from './errors.js';

export const BROWSERS = ['chrome', 'firefox', 'edge', 'brave', 'opera', 'vivaldi', 'chromium'] as const;

export const settingsSchema = z.object({
  mediaDir: z.string().min(1),
  maxHeight: z.union([
    z.literal(360),
    z.literal(480),
    z.literal(720),
    z.literal(1080),
    z.literal(1440),
    z.literal(2160),
  ]),
  concurrency: z.number().int().min(1).max(3),
  autoDownload: z.boolean(),
  /** Lets yt-dlp read your browser cookies for private or age-restricted videos. */
  cookiesFromBrowser: z.union([z.literal(''), z.enum(BROWSERS)]),
  /** 'local' listens on 127.0.0.1 only; 'home' also accepts password-protected devices on the network. */
  network: z.enum(['local', 'home']),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  mediaDir: DEFAULT_MEDIA_DIR,
  maxHeight: 1080,
  concurrency: 1,
  autoDownload: true,
  cookiesFromBrowser: '',
  network: 'local',
};

function parseStored(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function getSettings(db: DB): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  const stored = Object.fromEntries(rows.map((r) => [r.key, parseStored(r.value)]));
  const parsed = settingsSchema.partial().safeParse(stored);
  return { ...DEFAULT_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

/** The download folder must exist (or be creatable) and be writable before it is saved. */
export function assertWritableDir(dir: string): void {
  if (!path.isAbsolute(dir)) throw new HttpError(400, 'The download folder must be a full path, like D:\\Movies');
  try {
    mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.youtube-flix-write-test-${process.pid}`);
    writeFileSync(probe, '');
    unlinkSync(probe);
  } catch (err) {
    throw new HttpError(400, `Cannot write to the download folder: ${(err as Error).message}`);
  }
}

export function saveSettings(db: DB, patch: Partial<Settings>): Settings {
  const next = settingsSchema.parse({ ...getSettings(db), ...patch });
  if (patch.mediaDir !== undefined) assertWritableDir(next.mediaDir);
  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  );
  db.transaction(() => {
    Object.entries(next).forEach(([key, value]) => upsert.run(key, JSON.stringify(value)));
  })();
  return next;
}

export function cookieArgs(settings: Settings): string[] {
  return settings.cookiesFromBrowser ? ['--cookies-from-browser', settings.cookiesFromBrowser] : [];
}
