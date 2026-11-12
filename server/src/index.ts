import { mkdirSync } from 'node:fs';
import { createApp } from './app.js';
import { hasPassword, lanAddresses } from './auth.js';
import { DATA_DIR, DB_PATH, HOST, PORT } from './config.js';
import { openDb } from './db.js';
import { DownloadQueue } from './downloads/queue.js';
import { createListener, listenHost, type Network } from './listener.js';
import { cookieArgs, getSettings } from './settings.js';
import { jsRuntimeArgs, toolStatus } from './tools.js';
import { createYtDlpFetcher } from './youtube/ytdlp.js';

mkdirSync(DATA_DIR, { recursive: true });
const db = openDb(DB_PATH);
const queue = new DownloadQueue(db);
const fetcher = createYtDlpFetcher(() => [...jsRuntimeArgs(), ...cookieArgs(getSettings(db))]);
/** Set by `npm run dev` (src/dev.ts): pages come from Vite there, and this server stays on this PC. */
const DEV_UI_URL = process.env.YTF_DEV_UI_URL || undefined;

const app = createApp({
  db,
  fetcher,
  queue,
  devUiUrl: DEV_UI_URL,
  onNetworkChange: (network) => void listener.rebind(network).then(announce, fatal),
});

const hostFor = (network: Network) => listenHost({ network, hasPassword: hasPassword(db), dev: Boolean(DEV_UI_URL) });
const listener = createListener(app, PORT, hostFor, HOST);

function announce(host: string) {
  if (DEV_UI_URL) {
    console.log(`youtube-flix dev server (data only) on http://${HOST}:${PORT}. Open the app at ${DEV_UI_URL}`);
    return;
  }
  console.log(`youtube-flix server on http://${HOST}:${PORT}`);
  if (host === HOST) return;
  console.log('  Home network access is ON. Other devices can open:');
  lanAddresses().forEach(({ name, address }) => console.log(`    http://${address}:${PORT}  (${name})`));
}

function fatal(err: Error) {
  console.error(`youtube-flix could not listen on ${HOST}:${PORT}: ${err.message}`);
  process.exit(1);
}

listener
  .start(getSettings(db).network)
  .then(async (host) => {
    announce(host);
    const { ytDlp, ffmpeg } = await toolStatus();
    console.log(`  yt-dlp: ${ytDlp.ok ? ytDlp.version : 'NOT FOUND — run "npm install" again or install yt-dlp'}`);
    console.log(`  ffmpeg: ${ffmpeg.ok ? ffmpeg.version : 'NOT FOUND — downloads cannot merge video and audio'}`);
    queue.restore();
  }, fatal);
