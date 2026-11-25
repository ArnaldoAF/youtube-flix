import { mkdtempSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import * as auth from '../src/auth.js';
import {
  collectionOf,
  createCollection,
  deleteCollection,
  listCollections,
  updateCollection,
} from '../src/catalog/collections.js';
import { suggestCollections } from '../src/catalog/detect.js';
import * as repo from '../src/catalog/repo.js';
import { applyCatalogImport } from '../src/catalogImport.js';
import { openDb, type DB } from '../src/db.js';
import type { DownloadQueue } from '../src/downloads/queue.js';
import { exportCatalog } from '../src/transfer.js';
import type { Fetcher } from '../src/youtube/ytdlp.js';

let db: DB;
beforeEach(() => {
  db = openDb(':memory:');
});

const meta = (youtubeId: string) => ({
  youtubeId,
  title: youtubeId,
  description: '',
  duration: 100,
  thumbnail: '',
  channel: null,
  uploadDate: null,
  chapters: [],
});

let nextId = 0;
const videoId = () => `vid${String(nextId++).padStart(8, '0')}`;

/** A movie with `parts` videos; returns the title id and its episode ids in order. */
function movie(name: string, channel = 'Deerstalker Pictures', parts = 1): { id: number; episodes: number[] } {
  const id = repo.createTitle(db, { type: 'movie', name, description: '', thumbnail: null, channel, sourceUrl: `https://www.youtube.com/watch?v=${videoId()}` });
  const seasonId = repo.createSeason(db, { titleId: id, number: 1, name: 'Parts', playlistId: null, sourceUrl: null });
  const episodes = repo.upsertEpisodes(db, seasonId, Array.from({ length: parts }, () => meta(videoId())));
  return { id, episodes };
}

function series(name: string): number {
  const id = repo.createTitle(db, { type: 'series', name, description: '', thumbnail: null, channel: 'x', sourceUrl: 'https://www.youtube.com/playlist?list=PLseries1234' });
  const seasonId = repo.createSeason(db, { titleId: id, number: 1, name: 'Season 1', playlistId: null, sourceUrl: null });
  repo.upsertEpisodes(db, seasonId, [meta(videoId())]);
  return id;
}

const ref = (titleId: number) => repo.listTitles(db).find((t) => t.id === titleId)?.collection;

describe('collections', () => {
  it('groups movies in order, and each movie knows its place', () => {
    const p1 = movie('Nixie - Part 1');
    const p2 = movie('Nixie - Part 2');

    const id = createCollection(db, 'Nixie', [p1.id, p2.id]);

    expect(listCollections(db)).toEqual([{ id, name: 'Nixie', titleIds: [p1.id, p2.id] }]);
    expect(collectionOf(db, p2.id)).toEqual({ id, name: 'Nixie', position: 2, size: 2 });
    expect(ref(p1.id)).toEqual({ id, name: 'Nixie', position: 1, size: 2 });
    expect(repo.getTitle(db, p1.id).collection).toEqual({ id, name: 'Nixie', position: 1, size: 2 });
  });

  it('accepts movies only, at least two, each in one collection', () => {
    const a = movie('A');
    const b = movie('B');
    const c = movie('C');
    const show = series('Show');

    expect(() => createCollection(db, 'X', [a.id, show])).toThrow(/movies/i);
    expect(() => createCollection(db, 'X', [a.id])).toThrow(/at least 2/i);
    expect(() => createCollection(db, 'X', [a.id, a.id])).toThrow(/twice/i);
    expect(() => createCollection(db, 'X', [a.id, 999])).toThrow(/not found/i);
    createCollection(db, 'First', [a.id, b.id]);
    expect(() => createCollection(db, 'Second', [b.id, c.id])).toThrow(/already in “First”/);
    expect(() => createCollection(db, '   ', [c.id, a.id])).toThrow(/name/i);
  });

  it('renames, reorders and adds movies', () => {
    const a = movie('A');
    const b = movie('B');
    const c = movie('C');
    const id = createCollection(db, 'Saga', [a.id, b.id]);

    updateCollection(db, id, { name: 'The Saga', titleIds: [c.id, b.id, a.id] });

    expect(listCollections(db)).toEqual([{ id, name: 'The Saga', titleIds: [c.id, b.id, a.id] }]);
    expect(collectionOf(db, a.id)?.position).toBe(3);
  });

  it('removes a collection once fewer than two movies are left', () => {
    const a = movie('A');
    const b = movie('B');
    const c = movie('C');
    const id = createCollection(db, 'Saga', [a.id, b.id, c.id]);

    updateCollection(db, id, { titleIds: [a.id, b.id] });
    expect(listCollections(db)).toHaveLength(1);

    repo.deleteTitle(db, b.id);
    expect(listCollections(db)).toEqual([]);
    expect(collectionOf(db, a.id)).toBeNull();
    expect(repo.getTitle(db, a.id).name).toBe('A');
  });

  it('deleting a collection keeps its movies', () => {
    const a = movie('A');
    const b = movie('B');
    const id = createCollection(db, 'Saga', [a.id, b.id]);

    deleteCollection(db, id);

    expect(listCollections(db)).toEqual([]);
    expect(repo.listTitles(db).map((t) => t.name).sort()).toEqual(['A', 'B']);
  });
});

describe('next movie', () => {
  it('after the last part of a movie, "next" is the first part of the following movie', () => {
    const p1 = movie('Nixie - Part 1', 'D', 2);
    const p2 = movie('Nixie - Part 2', 'D', 1);
    createCollection(db, 'Nixie', [p1.id, p2.id]);

    const mid = repo.getEpisode(db, p1.episodes[0]);
    expect(mid).toMatchObject({ nextEpisodeId: p1.episodes[1], nextTitle: null });

    const end = repo.getEpisode(db, p1.episodes[1]);
    expect(end).toMatchObject({ nextEpisodeId: p2.episodes[0], nextTitle: { id: p2.id, name: 'Nixie - Part 2' } });

    expect(repo.getEpisode(db, p2.episodes[0])).toMatchObject({ nextEpisodeId: null, nextTitle: null });
  });

  it('movies outside a collection have no next movie', () => {
    const lone = movie('Lone');
    movie('Other');
    expect(repo.getEpisode(db, lone.episodes[0])).toMatchObject({ nextEpisodeId: null, nextTitle: null });
  });

  it('watching a saga in order: Continue watching offers only the movie in progress, once', () => {
    const a = movie('Saga Part 1');
    const b = movie('Saga Part 2');
    const c = movie('Saga Part 3');
    createCollection(db, 'Saga', [a.id, b.id, c.id]);
    const at = (iso: string, epId: number, seconds: number) =>
      db.prepare('INSERT OR REPLACE INTO progress (episode_id, seconds, duration, updated_at) VALUES (?, ?, 100, ?)').run(epId, seconds, iso);
    at('2026-11-01 10:00:00', a.episodes[0], 99);
    at('2026-11-02 10:00:00', b.episodes[0], 99);
    at('2026-11-03 10:00:00', c.episodes[0], 50);

    expect(repo.continueWatching(db).map((x) => [x.title.id, x.episode.id])).toEqual([[c.id, c.episodes[0]]]);
  });

  it('a finished movie never brings back a sequel that was already finished', () => {
    const a = movie('Saga Part 1');
    const b = movie('Saga Part 2');
    createCollection(db, 'Saga', [a.id, b.id]);
    db.prepare("INSERT INTO progress (episode_id, seconds, duration, updated_at) VALUES (?, 99, 100, '2026-11-02 10:00:00')").run(b.episodes[0]);
    db.prepare("INSERT INTO progress (episode_id, seconds, duration, updated_at) VALUES (?, 99, 100, '2026-11-03 10:00:00')").run(a.episodes[0]);

    expect(repo.continueWatching(db)).toEqual([]);
  });

  it('skips a following movie that has no episodes', () => {
    const e = movie('E');
    const empty = repo.createTitle(db, { type: 'movie', name: 'F', description: '', thumbnail: null, channel: 'x', sourceUrl: 'https://www.youtube.com/watch?v=emptymovie1' });
    const g = movie('G');
    createCollection(db, 'Saga', [e.id, empty, g.id]);

    expect(repo.getEpisode(db, e.episodes[0])).toMatchObject({ nextEpisodeId: g.episodes[0], nextTitle: { id: g.id } });
  });

  it('Continue watching moves on to the next movie once one is finished', () => {
    const p1 = movie('Nixie - Part 1');
    const p2 = movie('Nixie - Part 2');
    createCollection(db, 'Nixie', [p1.id, p2.id]);
    repo.saveProgress(db, p1.episodes[0], 99, 100);

    expect(repo.continueWatching(db).map((c) => [c.title.id, c.episode.id])).toEqual([[p2.id, p2.episodes[0]]]);
  });
});

describe('suggestCollections', () => {
  const t = (id: number, name: string, channel: string | null = 'Deerstalker Pictures', type: 'movie' | 'series' = 'movie', inCollection = false) => ({
    id,
    name,
    channel,
    type,
    inCollection,
  });

  it('finds the real Nixie pair, ordered, named after the shared title', () => {
    const titles = [
      t(2, '1 FOR ALL: THE EXORCISM OF NIXIE - PART 2 (FINALE)'),
      t(1, '1 FOR ALL: THE EXORCISM OF NIXIE - PART 1'),
      t(3, 'CONTRA-FILÉ', 'Pedro Iuá'),
      t(4, 'Le Voyage dans la Lune (1902) - Georges Méliès', 'Billi Brass Quintet'),
    ];
    expect(suggestCollections(titles)).toEqual([{ name: '1 FOR ALL: THE EXORCISM OF NIXIE', titleIds: [1, 2] }]);
  });

  it.each([
    ['Part/Pt./Parte', ['Saga Part 1', 'Saga Pt. 2', 'Saga Parte 3']],
    ['Chapter/Capítulo', ['Saga: Chapter 1', 'Saga - Capítulo 2']],
    ['Roman numerals', ['Saga', 'Saga II', 'Saga III']],
    ['trailing numbers, any case and accents', ['Ação Total', 'ACAO TOTAL 2']],
  ])('recognises %s', (_label, names) => {
    const [suggestion] = suggestCollections(names.map((n, i) => t(i + 1, n)));
    expect(suggestion?.titleIds).toEqual(names.map((_, i) => i + 1));
  });

  it('does not mistake numbers in a name for parts', () => {
    expect(suggestCollections([t(1, 'Apollo 13'), t(2, 'Apollo')])).toEqual([]);
    expect(suggestCollections([t(1, 'Windows 10'), t(2, 'Windows 7'), t(3, 'Windows')])).toEqual([]);
    expect(suggestCollections([t(1, "Ocean's 11"), t(2, "Ocean's 12")])).toEqual([]);
    expect(suggestCollections([t(1, 'Saga Part 1'), t(2, 'Saga Part 5')])).toEqual([]);
  });

  it('a duplicate part keeps the first one instead of hiding the whole group', () => {
    expect(suggestCollections([t(1, 'Saga Part 1'), t(2, 'Saga Part 1 (HD)'), t(3, 'Saga Part 2')])).toEqual([{ name: 'Saga', titleIds: [1, 3] }]);
  });

  it('a story that starts later still counts, as long as the parts follow on', () => {
    expect(suggestCollections([t(1, 'Saga Part 2'), t(2, 'Saga Part 3')])).toEqual([{ name: 'Saga', titleIds: [1, 2] }]);
  });

  it('never suggests across channels, with series, with taken movies, or for unrelated titles', () => {
    expect(suggestCollections([t(1, 'Saga Part 1', 'A'), t(2, 'Saga Part 2', 'B')])).toEqual([]);
    expect(suggestCollections([t(1, 'Saga Part 1'), t(2, 'Saga Part 2', 'Deerstalker Pictures', 'series')])).toEqual([]);
    expect(suggestCollections([t(1, 'Saga Part 1'), t(2, 'Saga Part 2', 'Deerstalker Pictures', 'movie', true)])).toEqual([]);
    expect(suggestCollections([t(1, 'Good Boy'), t(2, 'Bad Boy'), t(3, 'Finley')])).toEqual([]);
    expect(suggestCollections([t(1, 'Saga Part 1'), t(2, 'Saga Part 1')])).toEqual([]);
  });
});

describe('routes', () => {
  let server: Server;
  let base: string;
  beforeEach(async () => {
    const queue = { snapshot: () => [], on: () => undefined, off: () => undefined, emit: () => true } as unknown as DownloadQueue;
    const app = createApp({ db, fetcher: {} as Fetcher, queue, isLocal: (req) => req.headers['x-test-remote'] !== '1' });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => server.close());

  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}/api${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  it('creates, lists, updates and deletes, with clear errors', async () => {
    const a = movie('Saga Part 1');
    const b = movie('Saga Part 2');

    expect((await (await call('GET', '/collections/suggestions')).json())).toEqual([{ name: 'Saga', titleIds: [a.id, b.id] }]);
    const created = await call('POST', '/collections', { name: 'Saga', titleIds: [a.id, b.id] });
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect(await (await call('GET', '/collections')).json()).toEqual([{ id, name: 'Saga', titleIds: [a.id, b.id] }]);
    expect(await (await call('GET', '/collections/suggestions')).json()).toEqual([]);

    expect((await call('PUT', `/collections/${id}`, { name: 'Saga!', titleIds: [b.id, a.id] })).status).toBe(200);
    expect(collectionOf(db, b.id)).toMatchObject({ name: 'Saga!', position: 1 });
    expect((await call('POST', '/collections', { name: 'Again', titleIds: [a.id, movie('C').id] })).status).toBe(409);
    expect((await call('POST', '/collections', { name: 'Bad', titleIds: ['x'] })).status).toBe(400);
    expect((await call('PUT', '/collections/9999', { name: 'Nope' })).status).toBe(404);

    expect((await call('DELETE', `/collections/${id}`)).status).toBe(204);
    expect(listCollections(db)).toEqual([]);
  });

  it('other devices can view and edit, but not delete a collection', async () => {
    await auth.setPassword(db, 'popcorn-night');
    const login = await call('POST', '/auth/login', { password: 'popcorn-night' }, { 'x-test-remote': '1' });
    const remote = { 'x-test-remote': '1', Cookie: (login.headers.get('set-cookie') ?? '').split(';')[0] };
    const a = movie('A');
    const b = movie('B');

    const created = await call('POST', '/collections', { name: 'Saga', titleIds: [a.id, b.id] }, remote);
    expect(created.status).toBe(201);
    const { id } = await created.json();
    expect((await call('GET', '/collections', undefined, remote)).status).toBe(200);
    expect((await call('PUT', `/collections/${id}`, { name: 'Renamed' }, remote)).status).toBe(200);
    expect((await call('DELETE', `/collections/${id}`, undefined, remote)).status).toBe(403);
    expect(listCollections(db)).toHaveLength(1);
  });
});

describe('moving the catalog', () => {
  const tmp = () => mkdtempSync(path.join(tmpdir(), 'ytf-collections-'));

  /** A catalog file on disk with the Nixie pair in a collection, as another computer would have it. */
  function otherComputer(dir: string): string {
    const file = path.join(dir, 'other.db');
    const other = openDb(file);
    const saved = db;
    db = other;
    const p1 = movie('Nixie - Part 1');
    const p2 = movie('Nixie - Part 2');
    createCollection(other, 'Nixie', [p1.id, p2.id]);
    db = saved;
    other.close();
    return file;
  }

  it('export keeps collections, and drops broken ones', async () => {
    const dir = tmp();
    const source = otherComputer(dir);
    const broken = new Database(source);
    // A damaged or hand-edited file does not enforce links between tables.
    broken.pragma('foreign_keys = OFF');
    broken.prepare("INSERT INTO collections (id, name) VALUES (90, 'Lonely')").run();
    // A collection whose only movie does not exist, and one with no movies at all.
    broken.prepare('INSERT INTO collection_items (collection_id, title_id, position) VALUES (90, 999, 1)').run();
    broken.prepare("INSERT INTO collections (id, name) VALUES (91, 'Ghosts')").run();
    broken.close();

    const out = path.join(dir, 'portable.db');
    await exportCatalog(source, out, { tmpRoot: dir });

    const result = new Database(out, { readonly: true });
    expect(result.prepare('SELECT name FROM collections').all()).toEqual([{ name: 'Nixie' }]);
    expect(result.prepare('SELECT COUNT(*) AS n FROM collection_items').get()).toEqual({ n: 2 });
    result.close();
  });

  it('replace brings the collections in as they are', async () => {
    const dir = tmp();
    const live = openDb(path.join(dir, 'youtube-flix.db'));
    await applyCatalogImport(live, otherComputer(dir), 'replace', { downloadsActive: false, tmpRoot: dir });
    expect(listCollections(live).map((c) => [c.name, c.titleIds.length])).toEqual([['Nixie', 2]]);
  });

  it('merge matches collections by name and maps their movies', async () => {
    const dir = tmp();
    const file = otherComputer(dir);
    const live = openDb(path.join(dir, 'youtube-flix.db'));

    const first = await applyCatalogImport(live, file, 'merge', { downloadsActive: false, tmpRoot: dir });
    expect(first.collectionsAdded).toBe(1);
    const [nixie] = listCollections(live);
    const names = nixie.titleIds.map((id) => repo.getTitle(live, id).name);
    expect(names).toEqual(['Nixie - Part 1', 'Nixie - Part 2']);

    const again = await applyCatalogImport(live, file, 'merge', { downloadsActive: false, tmpRoot: dir });
    expect(again.collectionsAdded).toBe(0);
    expect(listCollections(live)).toHaveLength(1);
  });

  it('merge copes with a file whose collection lists the same movie twice under two titles', async () => {
    const dir = tmp();
    const file = otherComputer(dir);
    const crafted = new Database(file);
    // A second title with Part 1's link: both map to one movie here.
    crafted.prepare("INSERT INTO titles (id, type, name, source_url) SELECT 50, type, name || ' copy', source_url FROM titles WHERE name = 'Nixie - Part 1'").run();
    crafted.prepare('INSERT INTO seasons (title_id, number, name) VALUES (50, 1, ?)').run('Parts');
    crafted.prepare('INSERT INTO collection_items (collection_id, title_id, position) SELECT collection_id, 50, 3 FROM collection_items LIMIT 1').run();
    crafted.close();
    const live = openDb(path.join(dir, 'youtube-flix.db'));

    await expect(applyCatalogImport(live, file, 'merge', { downloadsActive: false, tmpRoot: dir })).resolves.toMatchObject({ collectionsAdded: 1 });
    expect(listCollections(live).map((c) => c.titleIds.length)).toEqual([2]);
  });

  it('merge leaves movies that are already in another collection where they are', async () => {
    const dir = tmp();
    const file = otherComputer(dir);
    const live = openDb(path.join(dir, 'youtube-flix.db'));
    await applyCatalogImport(live, file, 'merge', { downloadsActive: false, tmpRoot: dir });
    const [nixie] = listCollections(live);
    updateCollection(live, nixie.id, { name: 'My own name' });

    await applyCatalogImport(live, file, 'merge', { downloadsActive: false, tmpRoot: dir });

    expect(listCollections(live).map((c) => c.name)).toEqual(['My own name']);
  });
});
