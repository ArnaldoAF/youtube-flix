import http, { type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import * as auth from '../src/auth.js';
import * as repo from '../src/catalog/repo.js';
import { openDb, type DB } from '../src/db.js';
import type { DownloadQueue } from '../src/downloads/queue.js';
import type { Fetcher } from '../src/youtube/ytdlp.js';

const PASSWORD = 'popcorn-night';
const fetcher = {} as Fetcher;

let db: DB;
let server: Server;
let port: number;
let clock: number;
let enqueued: number[][];
let networkChanges: string[];

beforeEach(async () => {
  db = openDb(':memory:');
  clock = 1_000_000;
  enqueued = [];
  networkChanges = [];
  const queue = {
    enqueue: (ids: number[]) => enqueued.push(ids),
    snapshot: () => [],
    on: () => undefined,
    off: () => undefined,
  } as unknown as DownloadQueue;
  const app = createApp({
    db,
    fetcher,
    queue,
    // Tests run over loopback; this header plays "a phone on the Wi-Fi".
    isLocal: (req) => req.headers['x-test-remote'] !== '1',
    onNetworkChange: (n) => networkChanges.push(n),
    loginLimiter: new auth.LoginLimiter(() => clock),
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  port = (server.address() as AddressInfo).port;
});

afterEach(() => server.close());

interface Res {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** node:http instead of fetch, because tests need to set the Host header. */
function call(
  method: string,
  urlPath: string,
  { remote = false, cookie, body, host, headers = {} }: { remote?: boolean; cookie?: string; body?: unknown; host?: string; headers?: Record<string, string> } = {},
): Promise<Res> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        method,
        path: urlPath,
        headers: {
          Host: host ?? `127.0.0.1:${port}`,
          ...(remote ? { 'x-test-remote': '1' } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }));
      },
    );
    req.on('error', reject);
    req.end(payload);
  });
}

const remote = (method: string, urlPath: string, opts: Parameters<typeof call>[2] = {}) => call(method, urlPath, { ...opts, remote: true });

async function login(password = PASSWORD): Promise<Res & { cookie?: string }> {
  const res = await remote('POST', '/api/auth/login', { body: { password } });
  const setCookie = res.headers['set-cookie']?.[0];
  return { ...res, cookie: setCookie?.split(';')[0] };
}

function seedDownloadedEpisode(): number {
  const dir = mkdtempSync(path.join(tmpdir(), 'ytf-n-'));
  const file = path.join(dir, 'aaaaaaaaaaa.mp4');
  writeFileSync(file, '0123456789');
  const titleId = repo.createTitle(db, { type: 'movie', name: 'M', description: '', thumbnail: null, channel: null, sourceUrl: 'x' });
  const seasonId = repo.createSeason(db, { titleId, number: 1, name: 'Parts', playlistId: null, sourceUrl: null });
  const [id] = repo.upsertEpisodes(db, seasonId, [
    { youtubeId: 'aaaaaaaaaaa', title: 'Ep', description: '', duration: 10, thumbnail: '', channel: null, uploadDate: null, chapters: [] },
  ]);
  db.prepare("UPDATE episodes SET local_path = ?, file_size = 10, download_status = 'done' WHERE id = ?").run(file, id);
  return id;
}

describe('the PC (loopback)', () => {
  it('needs no login', async () => {
    expect((await call('GET', '/api/titles')).status).toBe(200);
    expect(JSON.parse((await call('GET', '/api/auth/me')).body)).toMatchObject({ local: true, authenticated: true });
  });

  it('must still address itself as localhost (DNS rebinding)', async () => {
    expect((await call('GET', '/api/titles', { host: 'evil.example' })).status).toBe(403);
    expect((await call('GET', '/api/titles', { host: '192.168.0.4:4000' })).status).toBe(403);
  });
});

describe('another device on the network', () => {
  beforeEach(() => auth.setPassword(db, PASSWORD));

  it('gets 401 on data routes without a session, but can ask who it is', async () => {
    expect((await remote('GET', '/api/titles')).status).toBe(401);
    expect((await remote('GET', '/api/episodes/1/stream')).status).toBe(401);
    expect((await remote('GET', '/api/settings')).status).toBe(401);
    expect(JSON.parse((await remote('GET', '/api/auth/me')).body)).toMatchObject({ local: false, authenticated: false });
  });

  it('is rejected when the Host header is a foreign domain', async () => {
    expect((await remote('GET', '/api/auth/me', { host: 'evil.example' })).status).toBe(403);
    expect((await remote('GET', '/api/auth/me', { host: 'localhost:4000' })).status).toBe(403);
    expect((await remote('GET', '/api/auth/me', { host: '192.168.0.4:4000' })).status).toBe(200);
  });

  it('cannot log in from another site (CSRF)', async () => {
    const res = await remote('POST', '/api/auth/login', { body: { password: PASSWORD }, headers: { Origin: 'http://evil.example' } });
    expect(res.status).toBe(403);
  });

  it('logs in with an HttpOnly, SameSite=Strict cookie and can browse, stream, add downloads', async () => {
    const id = seedDownloadedEpisode();
    const { status, cookie, headers } = await login();
    expect(status).toBe(204);
    expect(headers['set-cookie']?.[0]).toMatch(/HttpOnly/);
    expect(headers['set-cookie']?.[0]).toMatch(/SameSite=Strict/);

    expect((await remote('GET', '/api/titles', { cookie })).status).toBe(200);
    expect((await remote('GET', '/api/auth/me', { cookie })).body).toContain('"authenticated":true');
    const range = await remote('GET', `/api/episodes/${id}/stream`, { cookie, headers: { Range: 'bytes=0-3' } });
    expect(range.status).toBe(206);
    expect(range.body).toBe('0123');
    expect((await remote('POST', '/api/downloads', { cookie, body: { episodeIds: [id] } })).status).toBe(202);
    expect(enqueued).toEqual([[id]]);
    expect((await remote('PUT', `/api/episodes/${id}/progress`, { cookie, body: { seconds: 5 } })).status).toBe(204);
    expect((await remote('PATCH', `/api/titles/${repo.listTitles(db)[0].id}`, { cookie, body: { tags: ['x'] } })).status).toBe(200);
  });

  it('gets 403 on PC-only routes even when logged in', async () => {
    const id = seedDownloadedEpisode();
    const { cookie } = await login();
    const titleId = repo.listTitles(db)[0].id;
    const forbidden = await Promise.all([
      remote('PUT', '/api/settings', { cookie, body: { autoDownload: false } }),
      remote('DELETE', `/api/titles/${titleId}`, { cookie }),
      remote('DELETE', `/api/episodes/${id}/file`, { cookie }),
      remote('POST', '/api/system/update-ytdlp', { cookie }),
      remote('PUT', '/api/auth/password', { cookie, body: { password: 'new-password-1' } }),
      remote('POST', '/api/auth/sign-out-all', { cookie }),
      remote('GET', '/api/network', { cookie }),
      remote('GET', '/api/some-future-route', { cookie }),
    ]);
    expect(forbidden.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403, 403]);
    expect(repo.listTitles(db)).toHaveLength(1);
    expect(await auth.verifyPassword(db, PASSWORD)).toBe(true);
  });

  it('is locked out for 15 minutes after 5 wrong passwords, even with the right one', async () => {
    for (let i = 0; i < auth.MAX_FAILURES_PER_ADDRESS; i++) expect((await login('wrong-guess')).status).toBe(401);
    expect((await login()).status).toBe(429);
    clock += auth.LOCK_WINDOW_MS + 1;
    expect((await login()).status).toBe(204);
  });

  it('a parallel burst of guesses cannot get past the limit', async () => {
    const results = await Promise.all([
      ...Array.from({ length: 20 }, () => login('wrong-guess')),
      login(),
    ]);
    const counts = results.reduce<Record<number, number>>((acc, r) => ({ ...acc, [r.status]: (acc[r.status] ?? 0) + 1 }), {});
    expect((counts[401] ?? 0) + (counts[204] ?? 0)).toBeLessThanOrEqual(auth.MAX_FAILURES_PER_ADDRESS);
    expect(counts[429]).toBeGreaterThanOrEqual(21 - auth.MAX_FAILURES_PER_ADDRESS);
  });

  it('the right password clears the address and gives back its global slot', () => {
    const limiter = new auth.LoginLimiter(() => clock);
    for (let i = 0; i < auth.MAX_FAILURES_GLOBAL; i++) {
      expect(limiter.tryAttempt(`10.0.0.${i % 200}`)).toBe(true);
      limiter.succeed(`10.0.0.${i % 200}`);
    }
    expect(limiter.tryAttempt('10.0.1.1')).toBe(true);
  });

  it('a password change from the PC signs every device out', async () => {
    const { cookie } = await login();
    expect((await call('PUT', '/api/auth/password', { body: { password: 'another-password' } })).status).toBe(204);
    expect((await remote('GET', '/api/titles', { cookie })).status).toBe(401);
    expect((await login()).status).toBe(401);
    expect((await login('another-password')).status).toBe(204);
  });

  it('"sign out all devices" and logout end sessions', async () => {
    const a = await login();
    const b = await login();
    expect((await remote('POST', '/api/auth/logout', { cookie: a.cookie })).status).toBe(204);
    expect((await remote('GET', '/api/titles', { cookie: a.cookie })).status).toBe(401);
    expect((await remote('GET', '/api/titles', { cookie: b.cookie })).status).toBe(200);
    expect((await call('POST', '/api/auth/sign-out-all')).status).toBe(204);
    expect((await remote('GET', '/api/titles', { cookie: b.cookie })).status).toBe(401);
  });
});

describe('settings', () => {
  it('never exposes the password hash', async () => {
    await auth.setPassword(db, PASSWORD);
    const body = (await call('GET', '/api/settings')).body;
    expect(body).not.toMatch(/scrypt|password/i);
  });

  it('a malformed stored hash accepts no password (fails closed)', async () => {
    for (const bad of ['scrypt$00$zz', 'scrypt$$', 'plain', `scrypt$${'a'.repeat(32)}$`]) {
      db.prepare('INSERT INTO auth (id, password_hash) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET password_hash = excluded.password_hash').run(bad);
      expect(await auth.verifyPassword(db, 'anything')).toBe(false);
      expect(await auth.verifyPassword(db, '')).toBe(false);
    }
  });

  it('rejects short passwords', async () => {
    expect((await call('PUT', '/api/auth/password', { body: { password: 'short' } })).status).toBe(400);
    expect(auth.hasPassword(db)).toBe(false);
  });

  it('home network needs a password first, and switching notifies the server to re-bind', async () => {
    expect((await call('PUT', '/api/settings', { body: { network: 'home' } })).status).toBe(400);
    expect(networkChanges).toEqual([]);
    await auth.setPassword(db, PASSWORD);
    expect((await call('PUT', '/api/settings', { body: { network: 'home' } })).status).toBe(200);
    expect((await call('PUT', '/api/settings', { body: { autoDownload: false } })).status).toBe(200);
    expect((await call('PUT', '/api/settings', { body: { network: 'local' } })).status).toBe(200);
    expect(networkChanges).toEqual(['home', 'local']);
  });
});

describe('sessions', () => {
  it('slide forward while used and expire after 90 idle days', () => {
    const token = auth.createSession(db, 0);
    expect(auth.checkSession(db, token, 1000)).toEqual({ valid: true, refresh: false });
    expect(auth.checkSession(db, token, 2 * 60 * 60 * 1000)).toEqual({ valid: true, refresh: true });
    const later = 2 * 60 * 60 * 1000 + auth.SESSION_MAX_AGE_MS + 1;
    expect(auth.checkSession(db, token, later).valid).toBe(false);
    expect(auth.checkSession(db, token, 0).valid).toBe(false);
  });

  it('stores only a hash of the token', () => {
    const token = auth.createSession(db);
    const rows = db.prepare('SELECT token_hash FROM sessions').all() as { token_hash: string }[];
    expect(rows.map((r) => r.token_hash)).not.toContain(token);
  });

  it('ignores unknown or missing cookies', () => {
    expect(auth.checkSession(db, undefined).valid).toBe(false);
    expect(auth.checkSession(db, 'forged').valid).toBe(false);
    expect(auth.readCookie('a=1; ytf_session=abc; b=2', 'ytf_session')).toBe('abc');
  });
});
