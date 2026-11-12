import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import * as auth from '../src/auth.js';
import * as repo from '../src/catalog/repo.js';
import { applyCatalogImport, previewCatalogImport, type ImportMode, type LiveImportOptions } from '../src/catalogImport.js';
import { openDb, type DB } from '../src/db.js';
import { DownloadQueue } from '../src/downloads/queue.js';
import { getSettings, saveSettings } from '../src/settings.js';
import { exportCatalog } from '../src/transfer.js';
import type { Fetcher } from '../src/youtube/ytdlp.js';

let dir: string;
let tmpRoot: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ytf-live-import-'));
  tmpRoot = path.join(dir, 'tmp');
  mkdirSync(tmpRoot);
});

interface SeedTitle {
  type?: 'movie' | 'series';
  name: string;
  source: string;
  tags?: string[];
  /** Season number → YouTube ids, in order. */
  seasons: Record<number, string[]>;
}

const meta = (youtubeId: string) => ({
  youtubeId,
  title: `Episode ${youtubeId}`,
  description: '',
  duration: 100,
  thumbnail: '',
  channel: null,
  uploadDate: null,
  chapters: [],
});

function addTitle(db: DB, t: SeedTitle): number {
  // Short names become real playlist links, as the app stores them; anything with a scheme is kept as given.
  const sourceUrl = t.source.includes(':') ? t.source : `https://www.youtube.com/playlist?list=PL${t.source}`;
  const titleId = repo.createTitle(db, { type: t.type ?? 'series', name: t.name, description: '', thumbnail: null, channel: null, sourceUrl });
  if (t.tags) repo.updateTitle(db, titleId, { tags: t.tags });
  Object.entries(t.seasons).forEach(([number, ids]) => {
    const seasonId = repo.createSeason(db, { titleId, number: Number(number), name: `Season ${number}`, playlistId: null, sourceUrl: null });
    repo.upsertEpisodes(db, seasonId, ids.map(meta));
  });
  return titleId;
}

const episodeId = (db: DB, youtubeId: string, titleName?: string) =>
  (
    db
      .prepare(
        `SELECT e.id FROM episodes e JOIN seasons s ON s.id = e.season_id JOIN titles t ON t.id = s.title_id
         WHERE e.youtube_id = ? AND (? IS NULL OR t.name = ?)`,
      )
      .get(youtubeId, titleName ?? null, titleName ?? null) as { id: number }
  ).id;

const setProgress = (db: DB, epId: number, seconds: number, at: string) =>
  db.prepare('INSERT OR REPLACE INTO progress (episode_id, seconds, duration, updated_at) VALUES (?, ?, 100, ?)').run(epId, seconds, at);

function markDownloaded(db: DB, epId: number, file: string, bytes = 1000) {
  writeFileSync(file, Buffer.alloc(bytes));
  db.prepare("UPDATE episodes SET download_status = 'done', local_path = ?, file_size = ? WHERE id = ?").run(file, bytes, epId);
}

/** The catalog on "the other computer", exported to a portable file. */
async function makeImportFile(build: (db: DB) => unknown): Promise<string> {
  const source = path.join(dir, `other-${Math.random().toString(36).slice(2)}.db`);
  const db = openDb(source);
  await build(db);
  db.close();
  const file = path.join(dir, `import-${path.basename(source)}`);
  await exportCatalog(source, file, { tmpRoot });
  return file;
}

/** This computer's live catalog, with a password, a session and machine settings. */
async function makeLiveCatalog(build: (db: DB) => unknown): Promise<DB> {
  const db = openDb(path.join(dir, 'youtube-flix.db'));
  saveSettings(db, { mediaDir: path.join(dir, 'media'), maxHeight: 1080, autoDownload: true, cookiesFromBrowser: 'edge' });
  await auth.setPassword(db, 'popcorn-night');
  saveSettings(db, { network: 'home' });
  auth.createSession(db);
  build(db);
  return db;
}

const titleNames = (db: DB) => repo.listTitles(db).map((t) => t.name).sort();
const count = (db: DB, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const snapshotOf = (db: DB) =>
  ['titles', 'seasons', 'episodes', 'progress', 'settings', 'auth', 'sessions'].map((t) =>
    JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all()),
  );

/** A function: tmpRoot is only set in beforeEach. */
const opts = (extra: Partial<LiveImportOptions> = {}): LiveImportOptions => ({ downloadsActive: false, tmpRoot, ...extra });

describe('merge', () => {
  it('adds new titles with their seasons, episodes and watch progress, without touching existing ids', async () => {
    const live = await makeLiveCatalog((db) => addTitle(db, { name: 'Mine', source: 'mine', seasons: { 1: ['aaaaaaaaaaa'] } }));
    const mineEpisode = episodeId(live, 'aaaaaaaaaaa');
    const file = await makeImportFile((db) => {
      addTitle(db, { name: 'New', source: 'new', tags: ['horror'], seasons: { 1: ['bbbbbbbbbbb', 'ccccccccccc'], 2: ['ddddddddddd'] } });
      setProgress(db, episodeId(db, 'ccccccccccc'), 30, '2026-11-01 10:00:00');
    });

    const summary = await applyCatalogImport(live, file, 'merge', opts());

    expect(summary).toMatchObject({ mode: 'merge', addedTitles: 1, updatedTitles: 0, addedEpisodes: 3, progressUpdated: 1, removedTitles: 0 });
    expect(titleNames(live)).toEqual(['Mine', 'New']);
    expect(episodeId(live, 'aaaaaaaaaaa')).toBe(mineEpisode);
    const added = repo.listTitles(live).find((t) => t.name === 'New');
    expect(added).toMatchObject({ tags: ['horror'], seasonCount: 2, episodeCount: 3 });
    expect(repo.getEpisode(live, episodeId(live, 'ccccccccccc')).episode.progress?.seconds).toBe(30);
  });

  it('merges into a title with the same type and link: keeps your edits and downloads, adds only what is new', async () => {
    const live = await makeLiveCatalog((db) => {
      addTitle(db, { name: 'My renamed series', source: 'PL-shared', tags: ['mine'], seasons: { 1: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] } });
      markDownloaded(db, episodeId(db, 'aaaaaaaaaaa'), path.join(dir, 'aaaaaaaaaaa.mp4'));
    });
    const file = await makeImportFile((db) =>
      addTitle(db, { name: 'Original name', source: 'PL-shared', tags: ['theirs', 'mine'], seasons: { 1: ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'], 2: ['ddddddddddd'] } }),
    );

    const summary = await applyCatalogImport(live, file, 'merge', opts());

    expect(summary).toMatchObject({ addedTitles: 0, updatedTitles: 1, addedEpisodes: 2 });
    const [title] = repo.listTitles(live);
    expect(title).toMatchObject({ name: 'My renamed series', tags: ['mine', 'theirs'], seasonCount: 2, episodeCount: 4, downloadedCount: 1 });
    expect(repo.getEpisode(live, episodeId(live, 'aaaaaaaaaaa')).episode.downloadStatus).toBe('done');
  });

  it('keeps a title separate when only the type differs', async () => {
    const live = await makeLiveCatalog((db) => addTitle(db, { type: 'movie', name: 'Film', source: 'same-link', seasons: { 1: ['aaaaaaaaaaa'] } }));
    const file = await makeImportFile((db) => addTitle(db, { type: 'series', name: 'Show', source: 'same-link', seasons: { 1: ['bbbbbbbbbbb'] } }));

    await applyCatalogImport(live, file, 'merge', opts());

    expect(titleNames(live)).toEqual(['Film', 'Show']);
  });

  it('the most recently watched position wins, in either direction', async () => {
    const live = await makeLiveCatalog((db) => {
      addTitle(db, { name: 'S', source: 'PL', seasons: { 1: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] } });
      setProgress(db, episodeId(db, 'aaaaaaaaaaa'), 10, '2026-11-05 10:00:00');
      setProgress(db, episodeId(db, 'bbbbbbbbbbb'), 90, '2026-11-09 10:00:00.500');
    });
    const file = await makeImportFile((db) => {
      addTitle(db, { name: 'S', source: 'PL', seasons: { 1: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] } });
      setProgress(db, episodeId(db, 'aaaaaaaaaaa'), 70, '2026-11-08 10:00:00');
      setProgress(db, episodeId(db, 'bbbbbbbbbbb'), 5, '2026-11-09 10:00:00');
    });

    const summary = await applyCatalogImport(live, file, 'merge', opts());

    expect(summary.progressUpdated).toBe(1);
    expect(repo.getEpisode(live, episodeId(live, 'aaaaaaaaaaa')).episode.progress?.seconds).toBe(70);
    expect(repo.getEpisode(live, episodeId(live, 'bbbbbbbbbbb')).episode.progress?.seconds).toBe(90);
  });

  it('importing the same file twice changes nothing the second time', async () => {
    const live = await makeLiveCatalog((db) => addTitle(db, { name: 'Mine', source: 'mine', seasons: { 1: ['aaaaaaaaaaa'] } }));
    const file = await makeImportFile((db) => {
      addTitle(db, { name: 'New', source: 'new', tags: ['x'], seasons: { 1: ['bbbbbbbbbbb'] } });
      setProgress(db, episodeId(db, 'bbbbbbbbbbb'), 30, '2026-11-01 10:00:00');
    });
    await applyCatalogImport(live, file, 'merge', opts());
    const before = snapshotOf(live);

    const second = await applyCatalogImport(live, file, 'merge', opts());

    expect(second).toMatchObject({ addedTitles: 0, updatedTitles: 0, addedEpisodes: 0, progressUpdated: 0 });
    expect(snapshotOf(live)).toEqual(before);
  });

  it('never touches settings, the password or signed-in devices', async () => {
    const live = await makeLiveCatalog(() => undefined);
    const file = await makeImportFile((db) => {
      saveSettings(db, { maxHeight: 360, autoDownload: false });
      addTitle(db, { name: 'New', source: 'new', seasons: { 1: ['bbbbbbbbbbb'] } });
    });

    await applyCatalogImport(live, file, 'merge', opts());

    expect(getSettings(live)).toMatchObject({ maxHeight: 1080, autoDownload: true, cookiesFromBrowser: 'edge', network: 'home' });
    expect(auth.hasPassword(live)).toBe(true);
    expect(count(live, 'sessions')).toBe(1);
  });

  it('links a new episode to a video this computer already has', async () => {
    const live = await makeLiveCatalog((db) => {
      addTitle(db, { type: 'movie', name: 'Mine', source: 'mine', seasons: { 1: ['aaaaaaaaaaa'] } });
      markDownloaded(db, episodeId(db, 'aaaaaaaaaaa'), path.join(dir, 'aaaaaaaaaaa.mp4'));
    });
    const file = await makeImportFile((db) => addTitle(db, { name: 'Compilation', source: 'other', seasons: { 1: ['aaaaaaaaaaa'] } }));

    const summary = await applyCatalogImport(live, file, 'merge', opts());

    expect(summary.relinkedVideos).toBe(1);
    expect(repo.getEpisode(live, episodeId(live, 'aaaaaaaaaaa', 'Compilation')).episode.downloadStatus).toBe('done');
  });

  it('is allowed while downloads are running', async () => {
    const live = await makeLiveCatalog(() => undefined);
    const file = await makeImportFile((db) => addTitle(db, { name: 'New', source: 'new', seasons: { 1: ['bbbbbbbbbbb'] } }));
    await expect(applyCatalogImport(live, file, 'merge', opts({ downloadsActive: true }))).resolves.toMatchObject({ addedTitles: 1 });
  });
});

describe('replace', () => {
  it('makes the catalog the imported one but keeps this computer’s password, devices and machine settings', async () => {
    const live = await makeLiveCatalog((db) => {
      addTitle(db, { name: 'Old A', source: 'a', seasons: { 1: ['aaaaaaaaaaa'] } });
      addTitle(db, { name: 'Old B', source: 'b', seasons: { 1: ['bbbbbbbbbbb'] } });
    });
    const file = await makeImportFile((db) => {
      saveSettings(db, { maxHeight: 720, concurrency: 3, autoDownload: false });
      addTitle(db, { name: 'Imported', source: 'i', seasons: { 1: ['ccccccccccc'] } });
      setProgress(db, episodeId(db, 'ccccccccccc'), 42, '2026-11-01 10:00:00');
    });

    const summary = await applyCatalogImport(live, file, 'replace', opts());

    expect(summary).toMatchObject({ mode: 'replace', removedTitles: 2, addedTitles: 1, incoming: { titles: 1, episodes: 1, withProgress: 1 } });
    expect(titleNames(live)).toEqual(['Imported']);
    expect(repo.getEpisode(live, episodeId(live, 'ccccccccccc')).episode.progress?.seconds).toBe(42);
    expect(getSettings(live)).toMatchObject({ maxHeight: 720, concurrency: 3, autoDownload: false, cookiesFromBrowser: 'edge', network: 'home' });
    expect(getSettings(live).mediaDir).toBe(path.join(dir, 'media'));
    expect(auth.hasPassword(live)).toBe(true);
    expect(count(live, 'sessions')).toBe(1);
  });

  it('keeps videos on disk: relinks those still in the catalog and reports the rest', async () => {
    const live = await makeLiveCatalog((db) => {
      addTitle(db, { name: 'Old', source: 'o', seasons: { 1: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] } });
      markDownloaded(db, episodeId(db, 'aaaaaaaaaaa'), path.join(dir, 'aaaaaaaaaaa.mp4'), 1000);
      markDownloaded(db, episodeId(db, 'bbbbbbbbbbb'), path.join(dir, 'bbbbbbbbbbb.mp4'), 2500);
    });
    const file = await makeImportFile((db) => addTitle(db, { name: 'Imported', source: 'i', seasons: { 1: ['aaaaaaaaaaa'] } }));

    const summary = await applyCatalogImport(live, file, 'replace', opts());

    expect(summary).toMatchObject({ relinkedVideos: 1, unlinked: { files: 1, bytes: 2500 } });
    expect(repo.getEpisode(live, episodeId(live, 'aaaaaaaaaaa')).episode.downloadStatus).toBe('done');
    expect(existsSync(path.join(dir, 'aaaaaaaaaaa.mp4'))).toBe(true);
    expect(existsSync(path.join(dir, 'bbbbbbbbbbb.mp4'))).toBe(true);
  });

  it('refuses while downloads are running, and changes nothing', async () => {
    const live = await makeLiveCatalog((db) => addTitle(db, { name: 'Old', source: 'o', seasons: { 1: ['aaaaaaaaaaa'] } }));
    const file = await makeImportFile((db) => addTitle(db, { name: 'Imported', source: 'i', seasons: { 1: ['bbbbbbbbbbb'] } }));
    const before = snapshotOf(live);

    await expect(applyCatalogImport(live, file, 'replace', opts({ downloadsActive: true }))).rejects.toThrow(/Pause or cancel downloads first/);

    expect(snapshotOf(live)).toEqual(before);
    expect(readdirSync(dir).filter((f) => f.includes('.backup-'))).toEqual([]);
  });
});

describe('replace with a damaged or hand-edited file', () => {
  it('takes only valid settings from it, and never resets this computer’s settings', async () => {
    const live = await makeLiveCatalog((db) => addTitle(db, { name: 'Old', source: 'o', seasons: { 1: ['aaaaaaaaaaa'] } }));
    const file = await makeImportFile((db) => {
      addTitle(db, { name: 'Imported', source: 'i', seasons: { 1: ['bbbbbbbbbbb'] } });
      saveSettings(db, { concurrency: 3 });
      db.prepare("UPDATE settings SET value = ? WHERE key = 'maxHeight'").run(JSON.stringify('999'));
      db.prepare("UPDATE settings SET value = ? WHERE key = 'autoDownload'").run('not json at all');
    });

    await applyCatalogImport(live, file, 'replace', opts());

    expect(getSettings(live)).toEqual({
      mediaDir: path.join(dir, 'media'),
      maxHeight: 1080,
      concurrency: 3,
      autoDownload: true,
      cookiesFromBrowser: 'edge',
      network: 'home',
    });
  });
});

describe('both modes', () => {
  it.each<ImportMode>(['merge', 'replace'])('%s saves a full backup first and reports its path', async (mode) => {
    const live = await makeLiveCatalog((db) => addTitle(db, { name: 'Before', source: 'b', seasons: { 1: ['aaaaaaaaaaa'] } }));
    const file = await makeImportFile((db) => addTitle(db, { name: 'Imported', source: 'i', seasons: { 1: ['bbbbbbbbbbb'] } }));

    const { backup } = await applyCatalogImport(live, file, mode, opts({ now: new Date(2026, 10, 11, 9, 30, 5) }));

    expect(backup).toBe(path.join(dir, 'youtube-flix.db.backup-20261111-093005'));
    const old = new Database(backup as string, { readonly: true });
    expect(old.prepare('SELECT name FROM titles').all()).toEqual([{ name: 'Before' }]);
    old.close();
  });

  it.each<ImportMode>(['merge', 'replace'])('%s preview matches what the import then does, and changes nothing', async (mode) => {
    const live = await makeLiveCatalog((db) => {
      addTitle(db, { name: 'Shared', source: 'PL', seasons: { 1: ['aaaaaaaaaaa'] } });
      addTitle(db, { name: 'Only mine', source: 'm', seasons: { 1: ['bbbbbbbbbbb'] } });
    });
    const file = await makeImportFile((db) => {
      addTitle(db, { name: 'Shared', source: 'PL', seasons: { 1: ['aaaaaaaaaaa', 'ccccccccccc'] } });
      addTitle(db, { name: 'Only theirs', source: 't', seasons: { 1: ['ddddddddddd'] } });
      setProgress(db, episodeId(db, 'ddddddddddd'), 12, '2026-11-01 10:00:00');
    });
    const before = snapshotOf(live);

    const preview = await previewCatalogImport(live, file, mode, opts());
    expect(snapshotOf(live)).toEqual(before);
    expect(readdirSync(dir).filter((f) => f.includes('.backup-'))).toEqual([]);

    const result = await applyCatalogImport(live, file, mode, opts());
    expect({ ...result, backup: null }).toEqual({ ...preview, backup: null });
  });

  it.each<ImportMode>(['merge', 'replace'])('%s rejects a file that is not a catalog and changes nothing', async (mode) => {
    const live = await makeLiveCatalog((db) => addTitle(db, { name: 'Mine', source: 'm', seasons: { 1: ['aaaaaaaaaaa'] } }));
    const bogus = path.join(dir, 'notes.db');
    writeFileSync(bogus, 'not a database');
    const before = snapshotOf(live);

    await expect(applyCatalogImport(live, bogus, mode, opts())).rejects.toThrow(/not a youtube-flix catalog/);
    expect(snapshotOf(live)).toEqual(before);
  });

  it.each<ImportMode>(['merge', 'replace'])('%s strips a full catalog copy too, never bringing in its downloads or password', async (mode) => {
    const live = await makeLiveCatalog(() => undefined);
    const raw = path.join(dir, 'raw.db');
    const other = openDb(raw);
    addTitle(other, { name: 'Raw', source: 'r', seasons: { 1: ['bbbbbbbbbbb'] } });
    markDownloaded(other, episodeId(other, 'bbbbbbbbbbb'), path.join(dir, 'their.mp4'));
    await auth.setPassword(other, 'someone-else');
    other.close();

    await applyCatalogImport(live, raw, mode, opts());

    expect(repo.getEpisode(live, episodeId(live, 'bbbbbbbbbbb')).episode.downloadStatus).toBe('none');
    expect(await auth.verifyPassword(live, 'popcorn-night')).toBe(true);
    expect(count(live, 'auth')).toBe(1);
  });

  it('leaves no temporary files behind', async () => {
    const live = await makeLiveCatalog(() => undefined);
    const file = await makeImportFile((db) => addTitle(db, { name: 'New', source: 'n', seasons: { 1: ['bbbbbbbbbbb'] } }));
    await previewCatalogImport(live, file, 'merge', opts());
    await applyCatalogImport(live, file, 'replace', opts());
    expect(readdirSync(tmpRoot)).toEqual([]);
  });
});

describe('imports running at the same time', () => {
  it('runs one at a time, and the first import’s backup always holds the original catalog', async () => {
    const live = await makeLiveCatalog((db) => addTitle(db, { name: 'ORIGINAL', source: 'o', seasons: { 1: ['aaaaaaaaaaa'] } }));
    const a = await makeImportFile((db) => addTitle(db, { name: 'A', source: 'a', seasons: { 1: ['bbbbbbbbbbb'] } }));
    const b = await makeImportFile((db) => addTitle(db, { name: 'B', source: 'b', seasons: { 1: ['ccccccccccc'] } }));
    const now = new Date(2026, 10, 11, 9, 30, 5);

    const [first, second] = await Promise.allSettled([
      applyCatalogImport(live, a, 'replace', opts({ now })),
      applyCatalogImport(live, b, 'replace', opts({ now })),
    ]);

    expect(first.status).toBe('fulfilled');
    expect(second.status).toBe('rejected');
    expect((second as PromiseRejectedResult).reason.message).toMatch(/Another catalog import is running/);
    expect(titleNames(live)).toEqual(['A']);
    const backup = new Database((first as PromiseFulfilledResult<{ backup: string }>).value.backup, { readonly: true });
    expect(backup.prepare('SELECT name FROM titles').all()).toEqual([{ name: 'ORIGINAL' }]);
    backup.close();
  });

  it('gives every backup its own file, even within the same second', async () => {
    const live = await makeLiveCatalog((db) => addTitle(db, { name: 'ORIGINAL', source: 'o', seasons: { 1: ['aaaaaaaaaaa'] } }));
    const file = await makeImportFile((db) => addTitle(db, { name: 'A', source: 'a', seasons: { 1: ['bbbbbbbbbbb'] } }));
    const now = new Date(2026, 10, 11, 9, 30, 5);

    const one = await applyCatalogImport(live, file, 'merge', opts({ now }));
    const two = await applyCatalogImport(live, file, 'merge', opts({ now }));

    expect(one.backup).not.toBe(two.backup);
    const first = new Database(one.backup as string, { readonly: true });
    expect(first.prepare('SELECT name FROM titles').all()).toEqual([{ name: 'ORIGINAL' }]);
    first.close();
  });
});

describe('a crafted or damaged file', () => {
  /** A full catalog written by hand, the way a hostile or broken file could be. */
  function craft(build: (db: DB) => void): string {
    const file = path.join(dir, `crafted-${Math.random().toString(36).slice(2)}.db`);
    const db = openDb(file);
    build(db);
    db.close();
    return file;
  }

  it.each<ImportMode>(['merge', 'replace'])('%s never runs the file’s own triggers', async (mode) => {
    const live = await makeLiveCatalog(() => undefined);
    const file = craft((db) => {
      addTitle(db, { name: 'Ok', source: 'https://www.youtube.com/playlist?list=PLok', seasons: { 1: ['aaaaaaaaaaa'] } });
      db.exec("CREATE TRIGGER boom AFTER UPDATE ON episodes BEGIN SELECT RAISE(ABORT, 'trigger ran'); END;");
      db.exec('CREATE VIEW sneaky AS SELECT * FROM titles;');
    });

    await expect(applyCatalogImport(live, file, mode, opts())).resolves.toMatchObject({ incoming: { titles: 1 } });
    expect(titleNames(live)).toEqual(['Ok']);
  });

  it.each<ImportMode>(['merge', 'replace'])('%s drops or blanks values the app could misuse', async (mode) => {
    const live = await makeLiveCatalog(() => undefined);
    const file = craft((db) => {
      const good = addTitle(db, { name: 'Good', source: 'https://www.youtube.com/playlist?list=PLgood', seasons: { 1: ['aaaaaaaaaaa', 'bbbbbbbbbbb'] } });
      addTitle(db, { name: 'Script link', source: 'javascript:alert(1)', seasons: { 1: ['ccccccccccc'] } });
      db.prepare("UPDATE titles SET thumbnail = 'javascript:alert(2)', tags = 'not json' WHERE id = ?").run(good);
      db.prepare("UPDATE episodes SET youtube_id = '../../evil' WHERE youtube_id = 'bbbbbbbbbbb'").run();
      db.prepare("UPDATE episodes SET duration = 'abc', thumbnail = 'file:///C:/secret.png' WHERE youtube_id = 'aaaaaaaaaaa'").run();
      db.prepare("UPDATE seasons SET source_url = 'javascript:x', playlist_id = '../bad'").run();
      setProgress(db, episodeId(db, 'aaaaaaaaaaa'), 30, '2026-11-01 10:00:00');
      db.prepare("UPDATE progress SET seconds = 'lots'").run();
    });

    await applyCatalogImport(live, file, mode, opts());

    expect(titleNames(live)).toEqual(['Good']);
    const [title] = repo.listTitles(live);
    expect(title).toMatchObject({ thumbnail: null, tags: [], episodeCount: 1 });
    const detail = repo.getTitle(live, title.id);
    expect(detail.seasons[0]).toMatchObject({ playlistId: null });
    expect(live.prepare('SELECT source_url FROM seasons').all()).toEqual([{ source_url: null }]);
    const [episode] = detail.seasons[0].episodes;
    expect(episode).toMatchObject({ youtubeId: 'aaaaaaaaaaa', duration: null, thumbnail: null, progress: null });
  });

  it('the terminal export cleans the same way', async () => {
    const source = craft((db) => {
      addTitle(db, { name: 'Good', source: 'https://youtu.be/aaaaaaaaaaa', seasons: { 1: ['aaaaaaaaaaa'] } });
      db.prepare("UPDATE episodes SET youtube_id = '..\\..\\evil'").run();
      db.exec("CREATE TRIGGER boom AFTER UPDATE ON episodes BEGIN SELECT RAISE(ABORT, 'trigger ran'); END;");
    });
    const out = path.join(dir, 'clean.db');

    await expect(exportCatalog(source, out, { tmpRoot })).resolves.toMatchObject({ titles: 1, episodes: 0 });
    const db = new Database(out, { readonly: true });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type IN ('trigger', 'view')").get()).toEqual({ n: 0 });
    db.close();
  });
});

describe('routes', () => {
  let server: Server;
  let base: string;
  let live: DB;

  beforeEach(async () => {
    live = await makeLiveCatalog((db) => addTitle(db, { name: 'Mine', source: 'm', seasons: { 1: ['aaaaaaaaaaa'] } }));
    const app = createApp({
      db: live,
      fetcher: {} as Fetcher,
      queue: new DownloadQueue(live),
      isLocal: (req) => req.headers['x-test-remote'] !== '1',
    });
    server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.once('listening', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(() => server.close());

  const upload = (route: string, body: Buffer, headers: Record<string, string> = {}) =>
    fetch(`${base}${route}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...headers }, body: new Uint8Array(body) });

  it('export downloads a portable catalog file with no password or sessions in it', async () => {
    const res = await fetch(`${base}/api/catalog/export`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="youtube-flix-catalog-\d{8}\.db"/);
    const file = path.join(dir, 'downloaded.db');
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    const db = new Database(file, { readonly: true });
    expect(db.prepare('SELECT name FROM titles').all()).toEqual([{ name: 'Mine' }]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM auth').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    db.close();
  });

  it('inspect previews without changing anything, and import applies', async () => {
    const file = await makeImportFile((db) => addTitle(db, { name: 'New', source: 'n', seasons: { 1: ['bbbbbbbbbbb'] } }));
    const body = readFileSync(file);

    const preview = await upload('/api/catalog/inspect?mode=merge', body);
    expect(preview.status).toBe(200);
    expect(await preview.json()).toMatchObject({ mode: 'merge', addedTitles: 1, backup: null });
    expect(titleNames(live)).toEqual(['Mine']);

    const applied = await upload('/api/catalog/import?mode=merge', body);
    expect(applied.status).toBe(200);
    expect((await applied.json()).backup).toMatch(/youtube-flix\.db\.backup-/);
    expect(titleNames(live)).toEqual(['Mine', 'New']);
  });

  it('rejects an unknown mode, a non-catalog file and an empty body with 400', async () => {
    const file = await makeImportFile((db) => addTitle(db, { name: 'New', source: 'n', seasons: { 1: ['bbbbbbbbbbb'] } }));
    expect((await upload('/api/catalog/import?mode=wipe', readFileSync(file))).status).toBe(400);
    expect((await upload('/api/catalog/import?mode=merge', Buffer.from('nope'))).status).toBe(400);
    expect((await upload('/api/catalog/import?mode=merge', Buffer.alloc(0))).status).toBe(400);
    expect(titleNames(live)).toEqual(['Mine']);
  });

  it('rejects a body over 50 MB with 413', async () => {
    const res = await upload('/api/catalog/inspect?mode=merge', Buffer.alloc(50 * 1024 * 1024 + 1));
    expect(res.status).toBe(413);
  });

  it('replace answers 409 while downloads are active', async () => {
    live.prepare("UPDATE episodes SET download_status = 'queued'").run();
    const file = await makeImportFile((db) => addTitle(db, { name: 'New', source: 'n', seasons: { 1: ['bbbbbbbbbbb'] } }));
    const res = await upload('/api/catalog/import?mode=replace', readFileSync(file));
    expect(res.status).toBe(409);
    expect(titleNames(live)).toEqual(['Mine']);
  });

  it('tells every open page the catalog changed after an import, but not after a preview', async () => {
    const file = readFileSync(await makeImportFile((db) => addTitle(db, { name: 'New', source: 'n', seasons: { 1: ['bbbbbbbbbbb'] } })));
    const controller = new AbortController();
    const events = await fetch(`${base}/api/downloads/events`, { signal: controller.signal });
    const reader = (events.body as ReadableStream<Uint8Array>).getReader();
    let received = '';
    const collect = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          received += new TextDecoder().decode(value);
        }
      } catch {
        // aborted at the end of the test
      }
    })();

    await upload('/api/catalog/inspect?mode=merge', file);
    await new Promise((r) => setTimeout(r, 300));
    expect(received).not.toContain('event: catalog');

    await upload('/api/catalog/import?mode=merge', file);
    // Wait for it rather than for a fixed time: on a busy machine the stream can lag behind the response.
    const deadline = Date.now() + 20_000;
    while (!received.includes('event: catalog') && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(received).toContain('event: catalog');

    await reader.cancel();
    controller.abort();
    await collect;
  });

  it('rejects a cross-site import', async () => {
    const file = await makeImportFile((db) => addTitle(db, { name: 'New', source: 'n', seasons: { 1: ['bbbbbbbbbbb'] } }));
    const res = await upload('/api/catalog/import?mode=replace', readFileSync(file), { Origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    expect(titleNames(live)).toEqual(['Mine']);
  });

  it('other devices get 403 on all three, even when signed in', async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-remote': '1' },
      body: JSON.stringify({ password: 'popcorn-night' }),
    });
    const headers = { 'x-test-remote': '1', Cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
    const file = readFileSync(await makeImportFile((db) => addTitle(db, { name: 'New', source: 'n', seasons: { 1: ['bbbbbbbbbbb'] } })));

    expect((await fetch(`${base}/api/catalog/export`, { headers })).status).toBe(403);
    expect((await upload('/api/catalog/inspect?mode=merge', file, headers)).status).toBe(403);
    expect((await upload('/api/catalog/import?mode=replace', file, headers)).status).toBe(403);
    expect(titleNames(live)).toEqual(['Mine']);
  });
});
