import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { CLIENT_DIST } from '../src/config.js';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import type { DownloadQueue } from '../src/downloads/queue.js';
import { listenHost } from '../src/listener.js';
import type { Fetcher } from '../src/youtube/ytdlp.js';

const queue = { snapshot: () => [], on: () => undefined, off: () => undefined } as unknown as DownloadQueue;

describe('listenHost', () => {
  it('opens to the home network only with a password, and never in dev mode', () => {
    expect(listenHost({ network: 'home', hasPassword: true, dev: false })).toBe('0.0.0.0');
    expect(listenHost({ network: 'home', hasPassword: false, dev: false })).toBe('127.0.0.1');
    expect(listenHost({ network: 'local', hasPassword: true, dev: false })).toBe('127.0.0.1');
    expect(listenHost({ network: 'home', hasPassword: true, dev: true })).toBe('127.0.0.1');
  });
});

describe('the dev server', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  async function start(devUiUrl?: string): Promise<string> {
    const app = createApp({ db: openDb(':memory:'), fetcher: {} as Fetcher, queue, devUiUrl });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server?.once('listening', r));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('serves no app pages, only a pointer to the live-reload page', async () => {
    const base = await start('http://127.0.0.1:6480');
    for (const page of ['/', '/downloads', '/settings?tab=catalog', '/index.html', '/assets/index.js']) {
      const res = await fetch(`${base}${page}`);
      const body = await res.text();
      expect(res.status, page).toBe(404);
      expect(body, page).toContain('http://127.0.0.1:6480');
      expect(body, page).not.toContain('<div id="root">');
    }
  });

  it('still answers the API', async () => {
    const base = await start('http://127.0.0.1:6480');
    const res = await fetch(`${base}/api/auth/me`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ local: true });
  });

  // Needs `npm run build` first; a fresh clone has no client/dist, and that is not a failure of this code.
  it.skipIf(!existsSync(path.join(CLIENT_DIST, 'index.html')))('the regular app keeps serving its pages', async () => {
    const base = await start();
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });
});
