import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import * as auth from '../src/auth.js';
import { removeEpisode, reorderSeason, restoreVideo, reverseSeason, updateEpisode } from '../src/catalog/episodes.js';
import * as repo from '../src/catalog/repo.js';
import { importTitle, refreshTitle } from '../src/catalog/service.js';
import { applyCatalogImport } from '../src/catalogImport.js';
import { openDb, type DB } from '../src/db.js';
import type { DownloadQueue } from '../src/downloads/queue.js';
import { exportCatalog } from '../src/transfer.js';
import type { PlaylistMeta, VideoMeta } from '../src/youtube/mapper.js';
import type { Fetcher } from '../src/youtube/ytdlp.js';

const PL = 'PLepisodes0001';

const video = (id: string): VideoMeta => ({
  youtubeId: id.padEnd(11, 'x'),
  title: `Video ${id}`,
  description: `about ${id}`,
  duration: 600,
  thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  channel: 'Chan',
  uploadDate: null,
  chapters: [],
});

function fakeFetcher(entries: string[]): Fetcher & { entries: string[] } {
  const f = {
    entries,
    fetchVideo: async (id: string) => video(id),
    fetchPlaylist: async (id: string): Promise<PlaylistMeta> => ({
      playlistId: id,
      title: 'Show',
      description: '',
      channel: 'Chan',
      thumbnail: null,
      entries: f.entries.map(video),
    }),
  };
  return f as unknown as Fetcher & { entries: string[] };
}

let db: DB;
let fetcher: Fetcher & { entries: string[] };

/** A one-season series from a playlist whose videos are, in YouTube's order, `ids`. */
async function show(ids: string[]): Promise<{ titleId: number; seasonId: number }> {
  fetcher = fakeFetcher(ids);
  const { titleId } = await importTitle(db, fetcher, { url: `https://www.youtube.com/playlist?list=${PL}`, type: 'series', seriesMode: 'season' });
  return { titleId, seasonId: repo.getTitle(db, titleId).seasons[0].id };
}

const season = (titleId: number) => repo.getTitle(db, titleId).seasons[0];
const order = (titleId: number) => season(titleId).episodes.map((e) => [e.position, e.youtubeId[0]]);
const episodeOf = (titleId: number, letter: string) => season(titleId).episodes.find((e) => e.youtubeId[0] === letter)!;

beforeEach(() => {
  db = openDb(':memory:');
});

describe('order', () => {
  it('reverse turns a newest-first playlist around, and new videos land at the end', async () => {
    const { titleId, seasonId } = await show(['c', 'b', 'a']);

    reverseSeason(db, seasonId);
    expect(order(titleId)).toEqual([[1, 'a'], [2, 'b'], [3, 'c']]);
    expect(season(titleId).orderMode).toBe('reversed');

    fetcher.entries = ['d', 'c', 'b', 'a'];
    await refreshTitle(db, fetcher, titleId);
    expect(order(titleId)).toEqual([[1, 'a'], [2, 'b'], [3, 'c'], [4, 'd']]);
  });

  it('reversing twice goes back to the playlist order', async () => {
    const { titleId, seasonId } = await show(['a', 'b']);
    reverseSeason(db, seasonId);
    reverseSeason(db, seasonId);
    expect(order(titleId)).toEqual([[1, 'a'], [2, 'b']]);
    expect(season(titleId).orderMode).toBe('playlist');
  });

  it('a hand-made order survives a playlist check; new videos are added at the end', async () => {
    const { titleId, seasonId } = await show(['a', 'b', 'c']);
    const [a, b, c] = season(titleId).episodes.map((e) => e.id);

    reorderSeason(db, seasonId, [c, a, b]);
    expect(order(titleId)).toEqual([[1, 'c'], [2, 'a'], [3, 'b']]);
    expect(season(titleId).orderMode).toBe('manual');

    fetcher.entries = ['n', 'a', 'b', 'c'];
    await refreshTitle(db, fetcher, titleId);
    expect(order(titleId)).toEqual([[1, 'c'], [2, 'a'], [3, 'b'], [4, 'n']]);
  });

  it('reversing a hand-made order flips it and keeps it hand-made', async () => {
    const { titleId, seasonId } = await show(['a', 'b', 'c']);
    const [a, b, c] = season(titleId).episodes.map((e) => e.id);
    reorderSeason(db, seasonId, [b, a, c]);
    reverseSeason(db, seasonId);
    expect(order(titleId)).toEqual([[1, 'c'], [2, 'a'], [3, 'b']]);
    expect(season(titleId).orderMode).toBe('manual');
  });

  it('a new order must list exactly the episodes of that season', async () => {
    const { titleId, seasonId } = await show(['a', 'b']);
    const [a, b] = season(titleId).episodes.map((e) => e.id);
    expect(() => reorderSeason(db, seasonId, [a])).toThrow(/every episode/i);
    expect(() => reorderSeason(db, seasonId, [a, a])).toThrow(/every episode/i);
    expect(() => reorderSeason(db, seasonId, [a, b, 999])).toThrow(/every episode/i);
    expect(() => reorderSeason(db, 999, [a, b])).toThrow(/season/i);
    expect(order(titleId)).toEqual([[1, 'a'], [2, 'b']]);
  });

  it('next episode and Play follow the new order', async () => {
    const { titleId, seasonId } = await show(['c', 'b', 'a']);
    reverseSeason(db, seasonId);
    const [a, b] = season(titleId).episodes.map((e) => e.id);
    expect(repo.getEpisode(db, a).nextEpisodeId).toBe(b);
    expect(repo.playTarget(db, titleId)).toBe(a);
  });
});

describe('editing', () => {
  it('a new name and description survive a playlist check', async () => {
    const { titleId } = await show(['a', 'b']);
    const a = episodeOf(titleId, 'a');
    updateEpisode(db, a.id, { name: 'Pilot', description: 'Where it starts' });
    await refreshTitle(db, fetcher, titleId);
    expect(episodeOf(titleId, 'a')).toMatchObject({ name: 'Pilot', description: 'Where it starts' });
    expect(episodeOf(titleId, 'b').name).toBe('Video b');
  });

  it('only changes what is given', async () => {
    const { titleId } = await show(['a']);
    updateEpisode(db, episodeOf(titleId, 'a').id, { name: 'Pilot' });
    expect(episodeOf(titleId, 'a')).toMatchObject({ name: 'Pilot', description: 'about a' });
    expect(() => updateEpisode(db, 999, { name: 'x' })).toThrow(/episode/i);
  });
});

describe('removing', () => {
  it('removes the episode and its progress, renumbers, and a playlist check does not bring it back', async () => {
    const { titleId } = await show(['a', 'b', 'c']);
    const b = episodeOf(titleId, 'b');
    repo.saveProgress(db, b.id, 50, 600);

    removeEpisode(db, b.id);
    expect(order(titleId)).toEqual([[1, 'a'], [2, 'c']]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM progress').get()).toEqual({ n: 0 });
    expect(season(titleId).removed).toEqual([{ youtubeId: b.youtubeId, name: 'Video b' }]);

    const added = await refreshTitle(db, fetcher, titleId);
    expect(added).toEqual([]);
    expect(order(titleId)).toEqual([[1, 'a'], [2, 'c']]);
  });

  it('keeps a hand-made order compact after a removal', async () => {
    const { titleId, seasonId } = await show(['a', 'b', 'c']);
    const [a, b, c] = season(titleId).episodes.map((e) => e.id);
    reorderSeason(db, seasonId, [c, b, a]);
    removeEpisode(db, b);
    await refreshTitle(db, fetcher, titleId);
    expect(order(titleId)).toEqual([[1, 'c'], [2, 'a']]);
  });

  it('restore lets the next playlist check add it again', async () => {
    const { titleId, seasonId } = await show(['a', 'b']);
    const b = episodeOf(titleId, 'b');
    removeEpisode(db, b.id);

    restoreVideo(db, seasonId, b.youtubeId);
    expect(season(titleId).removed).toEqual([]);
    expect(await refreshTitle(db, fetcher, titleId)).toHaveLength(1);
    expect(order(titleId)).toEqual([[1, 'a'], [2, 'b']]);
    expect(() => restoreVideo(db, seasonId, b.youtubeId)).toThrow(/removed video/i);
  });

  it('a playlist split into seasons does not bring a removed video back in another season', async () => {
    const titles: Record<string, string> = { a: 'S01E01', b: 'Intro bonus', c: 'S01E02', d: 'S02E01', e: 'S02E02' };
    const split = fakeFetcher(['a', 'b', 'c', 'd', 'e']);
    const named = {
      ...split,
      fetchPlaylist: async (id: string) => {
        const p = await split.fetchPlaylist(id);
        return { ...p, entries: p.entries.map((v) => ({ ...v, title: titles[v.youtubeId[0]] })) };
      },
    } as unknown as Fetcher;
    const { titleId } = await importTitle(db, named, { url: `https://www.youtube.com/playlist?list=${PL}`, type: 'series', seriesMode: 'series' });
    const letters = () => repo.getTitle(db, titleId).seasons.map((s) => s.episodes.map((e) => e.youtubeId[0]).join(''));
    expect(letters()).toEqual(['abc', 'de']);

    const bonus = repo.getTitle(db, titleId).seasons[0].episodes.find((e) => e.youtubeId[0] === 'b')!;
    removeEpisode(db, bonus.id);
    expect(await refreshTitle(db, named, titleId)).toEqual([]);
    expect(letters()).toEqual(['ac', 'de']);
  });

  it('removing the last episode of a series is refused', async () => {
    const { titleId } = await show(['a']);
    expect(() => removeEpisode(db, episodeOf(titleId, 'a').id)).toThrow(/last episode/i);
    expect(order(titleId)).toEqual([[1, 'a']]);
  });
});

describe('older libraries', () => {
  it('gain the new columns and table when opened, keeping their data', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'ytf-episodes-')), 'old.db');
    const old = new Database(file);
    old.exec(`
      CREATE TABLE titles (id INTEGER PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
        thumbnail TEXT, channel TEXT, source_url TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', featured INTEGER NOT NULL DEFAULT 0,
        added_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
      CREATE TABLE seasons (id INTEGER PRIMARY KEY, title_id INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
        number INTEGER NOT NULL, name TEXT NOT NULL, playlist_id TEXT, source_url TEXT, UNIQUE (title_id, number));
      CREATE TABLE episodes (id INTEGER PRIMARY KEY, season_id INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
        youtube_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', duration INTEGER, thumbnail TEXT,
        position INTEGER NOT NULL, upload_date TEXT, local_path TEXT, file_size INTEGER,
        download_status TEXT NOT NULL DEFAULT 'none', download_error TEXT, download_queued_at TEXT, UNIQUE (season_id, youtube_id));
      INSERT INTO titles (id, type, name, source_url) VALUES (1, 'series', 'Old', 'https://www.youtube.com/playlist?list=PLold');
      INSERT INTO seasons (id, title_id, number, name) VALUES (1, 1, 1, 'Season 1');
      INSERT INTO episodes (season_id, youtube_id, name, position) VALUES (1, 'aaaaaaaaaaa', 'One', 1);
    `);
    old.close();

    const opened = openDb(file);
    const s = repo.getTitle(opened, 1).seasons[0];
    expect(s.orderMode).toBe('playlist');
    expect(s.removed).toEqual([]);
    expect(s.episodes.map((e) => e.name)).toEqual(['One']);
    opened.close();
    expect(() => openDb(file).close()).not.toThrow(); // opening again changes nothing
  });
});

describe('routes', () => {
  let server: Server;
  let base: string;
  let calls: string[];

  beforeEach(async () => {
    calls = [];
    const queue = {
      snapshot: () => [],
      on: () => undefined,
      off: () => undefined,
      emit: () => true,
      cancel: (id: number) => calls.push(`cancel ${id}`),
      deleteFile: (id: number) => calls.push(`deleteFile ${id}`),
    } as unknown as DownloadQueue;
    const app = createApp({ db, fetcher: {} as Fetcher, queue, isLocal: (req) => req.headers['x-test-remote'] !== '1' });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => server.close());

  const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api${url}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function remote() {
    await auth.setPassword(db, 'popcorn-night');
    const login = await call('POST', '/auth/login', { password: 'popcorn-night' }, { 'x-test-remote': '1' });
    return { 'x-test-remote': '1', Cookie: (login.headers.get('set-cookie') ?? '').split(';')[0] };
  }

  it('other devices can reorder and edit, but not remove or restore', async () => {
    const { titleId, seasonId } = await show(['a', 'b']);
    const [a, b] = season(titleId).episodes.map((e) => e.id);
    const phone = await remote();

    expect((await call('POST', `/seasons/${seasonId}/reverse`, undefined, phone)).status).toBe(200);
    expect((await call('PUT', `/seasons/${seasonId}/order`, { episodeIds: [a, b] }, phone)).status).toBe(200);
    expect((await call('PATCH', `/episodes/${a}`, { name: 'Pilot' }, phone)).status).toBe(200);
    expect((await call('DELETE', `/episodes/${b}`, undefined, phone)).status).toBe(403);
    expect((await call('DELETE', `/seasons/${seasonId}/removed/${'b'.padEnd(11, 'x')}`, undefined, phone)).status).toBe(403);
    expect(order(titleId)).toEqual([[1, 'a'], [2, 'b']]);
    expect(calls).toEqual([]);
  });

  it('removing on this PC deletes the downloaded file, or only stops its download with keepFiles', async () => {
    const { titleId, seasonId } = await show(['a', 'b', 'c']);
    const [a, b] = season(titleId).episodes.map((e) => e.id);

    expect((await call('DELETE', `/episodes/${a}`)).status).toBe(204);
    expect((await call('DELETE', `/episodes/${b}?keepFiles=true`)).status).toBe(204);
    expect(calls).toEqual([`deleteFile ${a}`, `cancel ${b}`]);
    expect(order(titleId)).toEqual([[1, 'c']]);

    expect((await call('DELETE', `/seasons/${seasonId}/removed/${'a'.padEnd(11, 'x')}`)).status).toBe(204);
    expect(season(titleId).removed.map((r) => r.youtubeId[0])).toEqual(['b']);
  });

  it('rejects bad input with clear errors', async () => {
    const { titleId, seasonId } = await show(['a', 'b']);
    const [a] = season(titleId).episodes.map((e) => e.id);
    expect((await call('PUT', `/seasons/${seasonId}/order`, { episodeIds: [a] })).status).toBe(400);
    expect((await call('PUT', `/seasons/${seasonId}/order`, { episodeIds: 'x' })).status).toBe(400);
    expect((await call('PATCH', `/episodes/${a}`, { name: '   ' })).status).toBe(400);
    expect((await call('PATCH', '/episodes/999', { name: 'x' })).status).toBe(404);
    expect((await call('POST', '/seasons/999/reverse')).status).toBe(404);
    expect((await call('DELETE', '/episodes/999')).status).toBe(404);
    expect((await call('DELETE', `/seasons/${seasonId}/removed/bad.id`)).status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe('moving the catalog', () => {
  const tmp = () => mkdtempSync(path.join(tmpdir(), 'ytf-episodes-'));

  /** Another computer's catalog: the show reversed, episode a renamed, episode b removed. */
  async function otherComputer(dir: string): Promise<string> {
    const file = path.join(dir, 'other.db');
    const saved = db;
    db = openDb(file);
    const { titleId, seasonId } = await show(['c', 'b', 'a']);
    reverseSeason(db, seasonId);
    updateEpisode(db, episodeOf(titleId, 'a').id, { name: 'Pilot' });
    removeEpisode(db, episodeOf(titleId, 'b').id);
    db.close();
    db = saved;
    const out = path.join(dir, 'export.db');
    await exportCatalog(file, out, { tmpRoot: dir });
    return out;
  }

  it('replace brings the order, edits and removed videos', async () => {
    const dir = tmp();
    const file = await otherComputer(dir);
    const live = openDb(path.join(dir, 'live.db'));

    await applyCatalogImport(live, file, 'replace', { downloadsActive: false, tmpRoot: dir });
    const s = repo.getTitle(live, repo.listTitles(live)[0].id).seasons[0];
    expect(s.orderMode).toBe('reversed');
    expect(s.episodes.map((e) => [e.position, e.name])).toEqual([[1, 'Pilot'], [2, 'Video c']]);
    expect(s.removed.map((r) => r.name)).toEqual(['Video b']);
  });

  it('merge into a new series takes its order and removed videos', async () => {
    const dir = tmp();
    const file = await otherComputer(dir);
    const live = openDb(path.join(dir, 'live.db'));

    await applyCatalogImport(live, file, 'merge', { downloadsActive: false, tmpRoot: dir });
    const s = repo.getTitle(live, repo.listTitles(live)[0].id).seasons[0];
    expect(s.orderMode).toBe('reversed');
    expect(s.removed.map((r) => r.name)).toEqual(['Video b']);
    expect(s.episodes.map((e) => e.name)).toEqual(['Pilot', 'Video c']);
  });

  it('merge never brings back a video removed here, and keeps this order', async () => {
    const dir = tmp();
    const live = openDb(path.join(dir, 'live.db'));
    db = live;
    const { titleId } = await show(['a', 'b', 'c']);
    removeEpisode(db, episodeOf(titleId, 'c').id);
    const file = path.join(dir, 'other.db');
    db = openDb(file);
    await show(['a', 'b', 'c']);
    db.close();
    const out = path.join(dir, 'export.db');
    await exportCatalog(file, out, { tmpRoot: dir });
    db = live;

    await applyCatalogImport(live, out, 'merge', { downloadsActive: false, tmpRoot: dir });
    expect(order(titleId)).toEqual([[1, 'a'], [2, 'b']]);
    expect(season(titleId).orderMode).toBe('playlist');
  });

  it('a crafted file cannot slip in bad order modes, flags or removed videos', async () => {
    const dir = tmp();
    const file = await otherComputer(dir);
    const crafted = new Database(file);
    crafted.pragma('ignore_check_constraints = ON');
    crafted.pragma('foreign_keys = OFF');
    crafted.exec(`
      UPDATE seasons SET order_mode = 'sideways';
      UPDATE episodes SET edited = 7 WHERE name <> 'Pilot';
      INSERT INTO removed_videos (season_id, youtube_id, name) VALUES (1, '../../etc', 'x'), (999, 'zzzzzzzzzzz', 'y'), (1, 'qqqqqqqqqqq', 42);
    `);
    crafted.close();
    const live = openDb(path.join(dir, 'live.db'));

    await applyCatalogImport(live, file, 'replace', { downloadsActive: false, tmpRoot: dir });
    const s = repo.getTitle(live, repo.listTitles(live)[0].id).seasons[0];
    expect(s.orderMode).toBe('playlist');
    expect(s.removed.map((r) => r.youtubeId).sort()).toEqual(['b'.padEnd(11, 'x'), 'qqqqqqqqqqq']);
    expect(s.removed.every((r) => typeof r.name === 'string')).toBe(true);
    expect((live.prepare('SELECT DISTINCT edited FROM episodes').all() as { edited: number }[]).map((r) => r.edited).sort()).toEqual([0, 1]);
  });
});
