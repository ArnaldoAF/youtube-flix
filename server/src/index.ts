import { mkdirSync } from 'node:fs';
import { createApp } from './app.js';
import { hasPassword, lanAddresses } from './auth.js';
import { DATA_DIR, DB_PATH, HOST, PORT } from './config.js';
import { openDb } from './db.js';
import { DownloadQueue } from './downloads/queue.js';
import { createListener, type Network } from './listener.js';
import { cookieArgs, getSettings } from './settings.js';
import { jsRuntimeArgs, toolStatus } from './tools.js';
import { createYtDlpFetcher } from './youtube/ytdlp.js';

mkdirSync(DATA_DIR, { recursive: true });
const db = openDb(DB_PATH);
const queue = new DownloadQueue(db);
const fetcher = createYtDlpFetcher(() => [...jsRuntimeArgs(), ...cookieArgs(getSettings(db))]);
const app = createApp({ db, fetcher, queue, onNetworkChange: (network) => void listener.rebind(network).then(announce, fatal) });

// Home mode needs a password; without one, stay on this PC only.
const hostFor = (network: Network) => (network === 'home' && hasPassword(db) ? '0.0.0.0' : HOST);
const listener = createListener(app, PORT, hostFor, HOST);

function announce(host: string) {
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
