import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { openDb } from '../src/db.js';
import { DownloadQueue } from '../src/downloads/queue.js';
import type { Fetcher } from '../src/youtube/ytdlp.js';

const fetcher: Fetcher = {
  fetchVideo: async () => {
    throw new Error('not used');
  },
  fetchPlaylist: async () => {
    throw new Error('not used');
  },
};

let server: Server;
let base: string;
let host: string;

beforeAll(async () => {
  const db = openDb(':memory:');
  const app = createApp({ db, fetcher, queue: new DownloadQueue(db) });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`;
  base = `http://${host}/api`;
});

afterAll(() => server.close());

describe('request guards', () => {
  it('rejects cross-site writes', async () => {
    const res = await fetch(`${base}/downloads/1/cancel`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('rejects the opaque "null" origin', async () => {
    const res = await fetch(`${base}/system/update-ytdlp`, { method: 'POST', headers: { Origin: 'null' } });
    expect(res.status).toBe(403);
  });

  it('allows same-origin writes and writes without Origin', async () => {
    const same = await fetch(`${base}/downloads/999/cancel`, { method: 'POST', headers: { Origin: `http://${host}` } });
    const none = await fetch(`${base}/downloads/999/cancel`, { method: 'POST' });
    expect(same.status).toBe(204);
    expect(none.status).toBe(204);
  });

  it('allows cross-origin reads to be answered only via GET (no CORS headers)', async () => {
    const res = await fetch(`${base}/titles`, { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns 400 for malformed JSON instead of 500', async () => {
    const res = await fetch(`${base}/titles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{bad json',
    });
    expect(res.status).toBe(400);
  });
});

describe('settings', () => {
  it('rejects a download folder that cannot be written', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'ytf-s-'));
    const file = path.join(dir, 'a-file');
    writeFileSync(file, 'x');
    const put = (mediaDir: string) =>
      fetch(`${base}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaDir }),
      });

    expect((await put(path.join(file, 'media'))).status).toBe(400);
    expect((await put('relative/media')).status).toBe(400);
    const ok = await put(path.join(dir, 'media'));
    expect(ok.status).toBe(200);
    expect((await ok.json()).mediaDir).toBe(path.join(dir, 'media'));
  });
});
