import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import * as auth from '../src/auth.js';
import * as repo from '../src/catalog/repo.js';
import { openDb, type DB } from '../src/db.js';
import { DownloadQueue } from '../src/downloads/queue.js';
import { storageSummary } from '../src/downloads/store.js';
import { saveSettings } from '../src/settings.js';
import type { Fetcher } from '../src/youtube/ytdlp.js';

const PASSWORD = 'popcorn-night';

let db: DB;
let mediaDir: string;
let server: Server;
let base: string;

beforeEach(async () => {
  db = openDb(':memory:');
  // Never the real media folder: deletes in these tests touch actual files.
  mediaDir = mkdtempSync(path.join(tmpdir(), 'ytf-storage-'));
  saveSettings(db, { mediaDir });
  const app = createApp({
    db,
    fetcher: {} as Fetcher,
    queue: new DownloadQueue(db),
    isLocal: (req) => req.headers['x-test-remote'] !== '1',
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => server.close());

const fileOf = (youtubeId: string) => path.join(mediaDir, `${youtubeId}.mp4`);

/** Creates a title whose episodes are downloaded; the same youtubeId in two titles shares one file. */
function seedTitle(type: 'movie' | 'series', name: string, videos: Record<string, number>) {
  const titleId = repo.createTitle(db, { type, name, description: '', thumbnail: null, channel: null, sourceUrl: name });
  const seasonId = repo.createSeason(db, { titleId, number: 1, name: 'Season 1', playlistId: null, sourceUrl: null });
  const youtubeIds = Object.keys(videos);
  const episodeIds = repo.upsertEpisodes(
    db,
    seasonId,
    youtubeIds.map((youtubeId) => ({
      youtubeId,
      title: `${name} ${youtubeId}`,
      description: '',
      duration: 10,
      thumbnail: '',
      channel: null,
      uploadDate: null,
      chapters: [],
    })),
  );
  youtubeIds.forEach((youtubeId, i) => {
    writeFileSync(fileOf(youtubeId), Buffer.alloc(videos[youtubeId]));
    db.prepare("UPDATE episodes SET local_path = ?, file_size = ?, download_status = 'done' WHERE id = ?").run(
      fileOf(youtubeId),
      videos[youtubeId],
      episodeIds[i],
    );
  });
  return { titleId, seasonId, episodeIds };
}

const setStatus = (id: number, status: string) =>
  db.prepare('UPDATE episodes SET download_status = ?, local_path = NULL, file_size = NULL WHERE id = ?').run(status, id);

const statusOf = (id: number) => repo.getEpisode(db, id).episode.downloadStatus;

const deleteFiles = (body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${base}/api/downloads/files`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('storageSummary', () => {
  it('is empty when nothing is downloaded', () => {
    expect(storageSummary(db)).toEqual({ totalBytes: 0, fileCount: 0, split: { series: 0, movie: 0 }, titles: [], files: [] });
  });

  it('adds up distinct files and ranks titles and files largest first', () => {
    const small = seedTitle('movie', 'Small', { aaaaaaaaaaa: 100 });
    const big = seedTitle('series', 'Big', { bbbbbbbbbbb: 300, ccccccccccc: 500 });
    const summary = storageSummary(db);

    expect(summary).toMatchObject({ totalBytes: 900, fileCount: 3, split: { series: 800, movie: 100 } });
    expect(summary.titles.map((t) => [t.id, t.bytes, t.fileCount])).toEqual([
      [big.titleId, 800, 2],
      [small.titleId, 100, 1],
    ]);
    expect(summary.files.map((f) => f.bytes)).toEqual([500, 300, 100]);
    expect(summary.files[0].titles).toEqual([{ id: big.titleId, name: 'Big', type: 'series' }]);
  });

  it('counts a file shared by two titles once, and only as freeable when one title uses it', () => {
    const series = seedTitle('series', 'Series', { aaaaaaaaaaa: 1000, bbbbbbbbbbb: 200 });
    const movie = seedTitle('movie', 'Movie', { aaaaaaaaaaa: 1000 });
    const summary = storageSummary(db);

    expect(summary).toMatchObject({ totalBytes: 1200, fileCount: 2 });
    expect(summary.split.series + summary.split.movie).toBe(1200);

    const bySeries = summary.titles.find((t) => t.id === series.titleId);
    const byMovie = summary.titles.find((t) => t.id === movie.titleId);
    expect(bySeries).toMatchObject({ bytes: 1200, freeableBytes: 200 });
    expect(byMovie).toMatchObject({ bytes: 1000, freeableBytes: 0 });

    const shared = summary.files.find((f) => f.bytes === 1000);
    expect(shared?.episodeIds.sort()).toEqual([series.episodeIds[0], movie.episodeIds[0]].sort());
    expect(shared?.titles.map((t) => t.id).sort()).toEqual([series.titleId, movie.titleId].sort());
  });

  it("includes a title's unfinished downloads in what gets deleted, without counting them as files", () => {
    const { episodeIds: [done, queued, paused, untouched] } = seedTitle('series', 'S', {
      aaaaaaaaaaa: 100,
      bbbbbbbbbbb: 1,
      ccccccccccc: 1,
      ddddddddddd: 1,
    });
    setStatus(queued, 'queued');
    setStatus(paused, 'paused');
    setStatus(untouched, 'none');

    const [title] = storageSummary(db).titles;
    expect(title).toMatchObject({ fileCount: 1, bytes: 100, pendingCount: 2 });
    expect(title.episodeIds.sort()).toEqual([done, queued, paused].sort());
  });

  it('leaves out titles that have no finished files yet', () => {
    const { episodeIds: [id] } = seedTitle('series', 'S', { aaaaaaaaaaa: 100 });
    setStatus(id, 'queued');
    expect(storageSummary(db).titles).toEqual([]);
  });
});

describe('GET /api/downloads/storage', () => {
  it('returns the summary and never a file path', async () => {
    seedTitle('movie', 'M', { aaaaaaaaaaa: 100 });
    const res = await fetch(`${base}/api/downloads/storage`);
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(JSON.parse(text)).toMatchObject({ totalBytes: 100, fileCount: 1 });
    expect(text).not.toContain(mediaDir.replaceAll('\\', '\\\\'));
    expect(text).not.toContain('.mp4');
  });
});

describe('DELETE /api/downloads/files', () => {
  it('removes the file from disk but keeps the episode in the catalog with its progress', async () => {
    const { episodeIds: [id] } = seedTitle('movie', 'M', { aaaaaaaaaaa: 100 });
    repo.saveProgress(db, id, 42, 100);

    expect((await deleteFiles({ episodeIds: [id] })).status).toBe(204);

    expect(existsSync(fileOf('aaaaaaaaaaa'))).toBe(false);
    expect(repo.getEpisode(db, id).episode).toMatchObject({ downloadStatus: 'none', hasLocalFile: false });
    expect(repo.getEpisode(db, id).episode.progress?.seconds).toBe(42);
    expect(storageSummary(db).totalBytes).toBe(0);
  });

  it.each([
    ['series first', (a: number, b: number) => [a, b]],
    ['movie first', (a: number, b: number) => [b, a]],
  ])('removes a shared file from every title, whichever id comes first (%s)', async (_label, order) => {
    const series = seedTitle('series', 'S', { aaaaaaaaaaa: 100 });
    const movie = seedTitle('movie', 'M', { aaaaaaaaaaa: 100 });

    await deleteFiles({ episodeIds: order(series.episodeIds[0], movie.episodeIds[0]) });

    expect(existsSync(fileOf('aaaaaaaaaaa'))).toBe(false);
    expect(statusOf(series.episodeIds[0])).toBe('none');
    expect(statusOf(movie.episodeIds[0])).toBe('none');
  });

  it("a title's delete keeps a file another title still uses, and frees what the summary promised", async () => {
    const series = seedTitle('series', 'S', { aaaaaaaaaaa: 1000, bbbbbbbbbbb: 200 });
    const movie = seedTitle('movie', 'M', { aaaaaaaaaaa: 1000 });
    const before = storageSummary(db);
    const row = before.titles.find((t) => t.id === series.titleId);

    await deleteFiles({ episodeIds: row?.episodeIds });

    expect(existsSync(fileOf('aaaaaaaaaaa'))).toBe(true);
    expect(existsSync(fileOf('bbbbbbbbbbb'))).toBe(false);
    expect(statusOf(movie.episodeIds[0])).toBe('done');
    expect(before.totalBytes - storageSummary(db).totalBytes).toBe(row?.freeableBytes);
  });

  it("a title's delete also cancels its unfinished downloads", async () => {
    const { episodeIds: [done, queued, paused] } = seedTitle('series', 'S', {
      aaaaaaaaaaa: 100,
      bbbbbbbbbbb: 1,
      ccccccccccc: 1,
    });
    setStatus(queued, 'queued');
    setStatus(paused, 'paused');

    await deleteFiles({ episodeIds: storageSummary(db).titles[0].episodeIds });

    expect([done, queued, paused].map(statusOf)).toEqual(['none', 'none', 'none']);
  });

  it('ignores unknown ids', async () => {
    const { episodeIds: [id] } = seedTitle('movie', 'M', { aaaaaaaaaaa: 100 });
    expect((await deleteFiles({ episodeIds: [999_999, id] })).status).toBe(204);
    expect(statusOf(id)).toBe('none');
  });

  it.each([
    ['no ids', {}],
    ['an empty list', { episodeIds: [] }],
    ['a non-numeric id', { episodeIds: ['1'] }],
    ['a negative id', { episodeIds: [-1] }],
    ['too many ids', { episodeIds: Array.from({ length: 5001 }, (_, i) => i + 1) }],
  ])('returns 400 for %s and deletes nothing', async (_label, body) => {
    const { episodeIds: [id] } = seedTitle('movie', 'M', { aaaaaaaaaaa: 100 });
    expect((await deleteFiles(body)).status).toBe(400);
    expect(existsSync(fileOf('aaaaaaaaaaa'))).toBe(true);
    expect(statusOf(id)).toBe('done');
  });

  it('rejects a cross-site delete', async () => {
    const { episodeIds: [id] } = seedTitle('movie', 'M', { aaaaaaaaaaa: 100 });
    const res = await deleteFiles({ episodeIds: [id] }, { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(existsSync(fileOf('aaaaaaaaaaa'))).toBe(true);
  });
});

describe('another device on the network', () => {
  const REMOTE = { 'x-test-remote': '1' };

  async function signIn(): Promise<Record<string, string>> {
    await auth.setPassword(db, PASSWORD);
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...REMOTE },
      body: JSON.stringify({ password: PASSWORD }),
    });
    return { ...REMOTE, Cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
  }

  it('needs to be signed in for both routes', async () => {
    const { episodeIds: [id] } = seedTitle('movie', 'M', { aaaaaaaaaaa: 100 });
    expect((await fetch(`${base}/api/downloads/storage`, { headers: REMOTE })).status).toBe(401);
    expect((await deleteFiles({ episodeIds: [id] }, REMOTE)).status).toBe(401);
    expect(existsSync(fileOf('aaaaaaaaaaa'))).toBe(true);
  });

  it('can read the summary but gets 403 on delete, and the file stays', async () => {
    const { episodeIds: [id] } = seedTitle('movie', 'M', { aaaaaaaaaaa: 100 });
    const headers = await signIn();

    expect((await fetch(`${base}/api/downloads/storage`, { headers })).status).toBe(200);
    expect((await deleteFiles({ episodeIds: [id] }, headers)).status).toBe(403);
    expect(existsSync(fileOf('aaaaaaaaaaa'))).toBe(true);
    expect(statusOf(id)).toBe('done');
  });
});
