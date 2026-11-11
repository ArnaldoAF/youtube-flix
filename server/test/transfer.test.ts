import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import * as auth from '../src/auth.js';
import * as repo from '../src/catalog/repo.js';
import { openDb, type DB } from '../src/db.js';
import { getSettings, saveSettings } from '../src/settings.js';
import { CatalogTransferError, exportCatalog, importCatalog, importFailure } from '../src/transfer.js';

let dir: string;
let mediaDir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'ytf-transfer-'));
  mediaDir = path.join(dir, 'media-on-old-pc');
});

/** A catalog like the real one: downloads with absolute paths, progress, a password and machine settings. */
async function seedCatalog(file: string, titleName = 'Series A'): Promise<{ episodeIds: number[]; hash: string }> {
  const db = openDb(file);
  saveSettings(db, { mediaDir, maxHeight: 720, concurrency: 2, autoDownload: false, cookiesFromBrowser: 'chrome' });
  await auth.setPassword(db, 'popcorn-night');
  saveSettings(db, { network: 'home' });
  auth.createSession(db);

  const titleId = repo.createTitle(db, { type: 'series', name: titleName, description: 'd', thumbnail: null, channel: 'c', sourceUrl: 'u' });
  repo.updateTitle(db, titleId, { tags: ['horror'] });
  const seasonId = repo.createSeason(db, { titleId, number: 1, name: 'Season 1', playlistId: 'PL1', sourceUrl: null });
  const episodeIds = repo.upsertEpisodes(
    db,
    seasonId,
    ['aaaaaaaaaaa', 'bbbbbbbbbbb', 'ccccccccccc'].map((youtubeId) => ({
      youtubeId,
      title: youtubeId,
      description: '',
      duration: 100,
      thumbnail: '',
      channel: null,
      uploadDate: null,
      chapters: [],
    })),
  );
  const [done, failed, queued] = episodeIds;
  db.prepare("UPDATE episodes SET download_status = 'done', local_path = ?, file_size = 500 WHERE id = ?").run(
    path.join(mediaDir, 'aaaaaaaaaaa.mp4'),
    done,
  );
  db.prepare("UPDATE episodes SET download_status = 'error', download_error = 'boom' WHERE id = ?").run(failed);
  db.prepare("UPDATE episodes SET download_status = 'queued', download_queued_at = datetime('now') WHERE id = ?").run(queued);
  repo.saveProgress(db, done, 42, 100);
  const { password_hash: hash } = db.prepare('SELECT password_hash FROM auth').get() as { password_hash: string };
  db.close();
  return { episodeIds, hash };
}

const titleNames = (db: DB) => repo.listTitles(db).map((t) => t.name);

describe('exportCatalog', () => {
  it('keeps titles, seasons, episodes, tags, progress and portable settings', async () => {
    const source = path.join(dir, 'youtube-flix.db');
    const { episodeIds } = await seedCatalog(source);
    const dest = path.join(dir, 'export', 'youtube-flix-catalog.db');

    const counts = await exportCatalog(source, dest);

    expect(counts).toEqual({ titles: 1, episodes: 3, withProgress: 1 });
    const db = openDb(dest);
    const [title] = repo.listTitles(db);
    expect(title).toMatchObject({ name: 'Series A', tags: ['horror'], episodeCount: 3, downloadedCount: 0 });
    expect(repo.getTitle(db, title.id).seasons[0]).toMatchObject({ name: 'Season 1', playlistId: 'PL1' });
    expect(repo.getEpisode(db, episodeIds[0]).episode.progress?.seconds).toBe(42);
    expect(getSettings(db)).toMatchObject({ maxHeight: 720, concurrency: 2, autoDownload: false });
    db.close();
  });

  it('resets every download, so nothing claims a file the new computer does not have', async () => {
    const source = path.join(dir, 'youtube-flix.db');
    await seedCatalog(source);
    const dest = path.join(dir, 'out.db');
    await exportCatalog(source, dest);

    const db = new Database(dest, { readonly: true });
    expect(
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM episodes WHERE download_status <> 'none' OR local_path IS NOT NULL
             OR file_size IS NOT NULL OR download_error IS NOT NULL OR download_queued_at IS NOT NULL`,
        )
        .get(),
    ).toEqual({ n: 0 });
    db.close();
  });

  it('leaves out the password, sessions and settings that belong to the old computer', async () => {
    const source = path.join(dir, 'youtube-flix.db');
    const { hash } = await seedCatalog(source);
    const dest = path.join(dir, 'out.db');
    await exportCatalog(source, dest);

    const db = openDb(dest);
    expect(auth.hasPassword(db)).toBe(false);
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    const settings = getSettings(db);
    expect(settings.network).toBe('local');
    expect(settings.cookiesFromBrowser).toBe('');
    expect(settings.mediaDir).not.toBe(mediaDir);
    db.close();

    // Deleted rows must not linger in free pages of the file either.
    const bytes = readFileSync(dest);
    expect(bytes.includes(hash)).toBe(false);
    expect(bytes.includes('media-on-old-pc')).toBe(false);
  });

  it('writes a single self-contained file and leaves the source untouched', async () => {
    const source = path.join(dir, 'youtube-flix.db');
    await seedCatalog(source);
    const outDir = path.join(dir, 'out');
    await exportCatalog(source, path.join(outDir, 'catalog.db'));

    expect(readdirSync(outDir)).toEqual(['catalog.db']);
    const db = openDb(source);
    expect(auth.hasPassword(db)).toBe(true);
    expect(repo.listTitles(db)[0].downloadedCount).toBe(1);
    db.close();
  });

  it('captures the latest changes while the app still has the catalog open', async () => {
    const source = path.join(dir, 'youtube-flix.db');
    await seedCatalog(source);
    const running = openDb(source);
    repo.createTitle(running, { type: 'movie', name: 'Added while running', description: '', thumbnail: null, channel: null, sourceUrl: 'x' });

    const counts = await exportCatalog(source, path.join(dir, 'out.db'));
    running.close();

    expect(counts.titles).toBe(2);
  });

  it('replaces an older export at the same place', async () => {
    const source = path.join(dir, 'youtube-flix.db');
    await seedCatalog(source);
    const dest = path.join(dir, 'out.db');
    writeFileSync(dest, 'old export');

    await exportCatalog(source, dest);

    expect(titleNames(openDb(dest))).toEqual(['Series A']);
  });

  it('refuses to export onto the catalog itself', async () => {
    const source = path.join(dir, 'youtube-flix.db');
    await seedCatalog(source);
    await expect(exportCatalog(source, path.join(dir, '.', 'youtube-flix.db'))).rejects.toThrow(CatalogTransferError);
    expect(titleNames(openDb(source))).toEqual(['Series A']);
  });

  describe('never writes over the catalog through another name for it', () => {
    const passwordOf = (file: string) => {
      const db = openDb(file);
      const has = auth.hasPassword(db);
      db.close();
      return has;
    };

    it('a folder junction pointing at the data folder', async () => {
      const data = path.join(dir, 'data');
      mkdirSync(data);
      const source = path.join(data, 'youtube-flix.db');
      await seedCatalog(source);
      const alias = path.join(dir, 'alias');
      symlinkSync(data, alias, 'junction');

      await expect(exportCatalog(source, path.join(alias, 'youtube-flix.db'))).rejects.toThrow(CatalogTransferError);

      expect(passwordOf(source)).toBe(true);
      expect(titleNames(openDb(source))).toEqual(['Series A']);
    });

    it('a hard link to the catalog file', async () => {
      const source = path.join(dir, 'youtube-flix.db');
      await seedCatalog(source);
      const alias = path.join(dir, 'looks-like-an-export.db');
      linkSync(source, alias);

      await expect(exportCatalog(source, alias)).rejects.toThrow(CatalogTransferError);

      expect(passwordOf(source)).toBe(true);
    });

    it("the catalog's own side files", async () => {
      const source = path.join(dir, 'youtube-flix.db');
      await seedCatalog(source);
      await expect(exportCatalog(source, `${source}-wal`)).rejects.toThrow(CatalogTransferError);
      await expect(exportCatalog(source, `${source.toUpperCase()}-SHM`)).rejects.toThrow(CatalogTransferError);
    });
  });

  it('never leaves the unstripped copy anywhere, whether export or import succeeds or fails', async () => {
    const source = path.join(dir, 'youtube-flix.db');
    await seedCatalog(source);
    // A private temp root: the shared one also holds other test runs' work in progress.
    const tmpRoot = path.join(dir, 'tmp');
    mkdirSync(tmpRoot);
    const dbPath = path.join(dir, 'new-pc', 'youtube-flix.db');

    await exportCatalog(source, path.join(dir, 'out.db'), { tmpRoot });
    await importCatalog({ file: path.join(dir, 'out.db'), dbPath, tmpRoot });
    await expect(importCatalog({ file: path.join(dir, 'out.db'), dbPath, tmpRoot })).rejects.toThrow(/--replace/);
    await expect(exportCatalog(source, path.join(dir, 'out.db', 'nested.db'), { tmpRoot })).rejects.toThrow();

    expect(readdirSync(tmpRoot)).toEqual([]);
    expect(readdirSync(dir).filter((f) => f.startsWith('out.db'))).toEqual(['out.db']);
  });

  it('explains when there is no catalog to export', async () => {
    await expect(exportCatalog(path.join(dir, 'missing.db'), path.join(dir, 'out.db'))).rejects.toThrow(/No catalog found/);
    expect(existsSync(path.join(dir, 'missing.db'))).toBe(false);
  });
});

describe('importCatalog', () => {
  async function makeExport(name = 'Series A'): Promise<string> {
    const source = path.join(dir, `source-${name}.db`);
    await seedCatalog(source, name);
    const file = path.join(dir, `export-${name}.db`);
    await exportCatalog(source, file);
    return file;
  }

  it('sets up the catalog on a computer that has none yet', async () => {
    const file = await makeExport();
    const dataDir = path.join(dir, 'new-pc', 'data');
    const dbPath = path.join(dataDir, 'youtube-flix.db');

    const result = await importCatalog({ file, dbPath });

    expect(result).toEqual({ counts: { titles: 1, episodes: 3, withProgress: 1 }, backup: null });
    const db = openDb(dbPath);
    expect(titleNames(db)).toEqual(['Series A']);
    db.close();
  });

  it('replaces an empty catalog without asking, keeping a backup', async () => {
    const file = await makeExport();
    const dbPath = path.join(dir, 'youtube-flix.db');
    openDb(dbPath).close();

    const { backup } = await importCatalog({ file, dbPath });

    expect(backup && existsSync(backup)).toBe(true);
    expect(titleNames(openDb(dbPath))).toEqual(['Series A']);
  });

  it('refuses to overwrite a catalog that has titles unless asked to replace it', async () => {
    const file = await makeExport('Imported');
    const dbPath = path.join(dir, 'youtube-flix.db');
    await seedCatalog(dbPath, 'Already here');

    await expect(importCatalog({ file, dbPath })).rejects.toThrow(/already has 1 title.*--replace/s);

    expect(titleNames(openDb(dbPath))).toEqual(['Already here']);
    expect(readdirSync(dir).filter((f) => f.includes('backup'))).toEqual([]);
  });

  it('with replace, backs up the existing catalog in full before importing', async () => {
    const file = await makeExport('Imported');
    const dbPath = path.join(dir, 'youtube-flix.db');
    await seedCatalog(dbPath, 'Already here');
    // A change made through the app's own connection, right before it was quit.
    const running = openDb(dbPath);
    repo.createTitle(running, { type: 'movie', name: 'Added last', description: '', thumbnail: null, channel: null, sourceUrl: 'x' });
    running.close();

    const { backup } = await importCatalog({ file, dbPath, replace: true });

    expect(titleNames(openDb(dbPath))).toEqual(['Imported']);
    expect(backup).toMatch(/youtube-flix\.db\.backup-\d{8}-\d{6}$/);
    const old = openDb(backup as string);
    expect(titleNames(old).sort()).toEqual(['Added last', 'Already here']);
    expect(auth.hasPassword(old)).toBe(true);
    old.close();
  });

  it('cleans a full catalog copy too, not only exports', async () => {
    const raw = path.join(dir, 'raw-copy.db');
    await seedCatalog(raw);
    const dbPath = path.join(dir, 'data', 'youtube-flix.db');

    await importCatalog({ file: raw, dbPath });

    const db = openDb(dbPath);
    expect(auth.hasPassword(db)).toBe(false);
    expect(repo.listTitles(db)[0].downloadedCount).toBe(0);
    expect(getSettings(db).network).toBe('local');
    db.close();
  });

  it.each([
    ['a file that does not exist', () => path.join(dir, 'nope.db'), /not found/],
    ['a file that is not a database', () => {
      const f = path.join(dir, 'notes.db');
      writeFileSync(f, 'just some text, not SQLite at all');
      return f;
    }, /not a youtube-flix catalog/],
    ['a database from something else', () => {
      const f = path.join(dir, 'other.db');
      const other = new Database(f);
      other.exec('CREATE TABLE recipes (id INTEGER PRIMARY KEY)');
      other.close();
      return f;
    }, /not a youtube-flix catalog/],
  ])('rejects %s and leaves the current catalog alone', async (_label, makeFile, message) => {
    const dbPath = path.join(dir, 'youtube-flix.db');
    await seedCatalog(dbPath, 'Already here');

    await expect(importCatalog({ file: makeFile(), dbPath, replace: true })).rejects.toThrow(message);

    expect(titleNames(openDb(dbPath))).toEqual(['Already here']);
    expect(readdirSync(dir).filter((f) => f.includes('backup'))).toEqual([]);
  });

  it('never lets leftover side files of a deleted catalog replay onto the import', async () => {
    const file = await makeExport();
    // An old catalog whose recent changes (password, paths, settings) are still only in its WAL.
    const old = path.join(dir, 'old', 'youtube-flix.db');
    mkdirSync(path.dirname(old));
    const holder = openDb(old);
    await seedCatalog(old, 'Old');
    expect(existsSync(`${old}-wal`)).toBe(true);
    // The user deleted youtube-flix.db by hand; its -wal stayed behind.
    const data = path.join(dir, 'data');
    mkdirSync(data);
    const dbPath = path.join(data, 'youtube-flix.db');
    copyFileSync(`${old}-wal`, `${dbPath}-wal`);
    holder.close();

    await importCatalog({ file, dbPath });

    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(readdirSync(data).filter((f) => f.startsWith('youtube-flix.db-wal.stale-'))).toHaveLength(1);
    const db = openDb(dbPath);
    expect(auth.hasPassword(db)).toBe(false);
    expect(titleNames(db)).toEqual(['Series A']);
    expect(repo.listTitles(db)[0].downloadedCount).toBe(0);
    expect(getSettings(db).network).toBe('local');
    db.close();
  });

  it('refuses while youtube-flix has the catalog open, and changes nothing', async () => {
    const file = await makeExport('Imported');
    const dbPath = path.join(dir, 'youtube-flix.db');
    await seedCatalog(dbPath, 'Already here');
    const running = openDb(dbPath);
    repo.createTitle(running, { type: 'movie', name: 'Added while open', description: '', thumbnail: null, channel: null, sourceUrl: 'x' });

    await expect(importCatalog({ file, dbPath, replace: true })).rejects.toThrow(/in use.*Quit youtube-flix/s);

    expect(titleNames(running).sort()).toEqual(['Added while open', 'Already here']);
    running.close();
    expect(titleNames(openDb(dbPath)).sort()).toEqual(['Added while open', 'Already here']);
    expect(readdirSync(dir).filter((f) => f.includes('backup'))).toEqual([]);
  });

  it('asks before replacing a catalog that has a household password, even with no titles', async () => {
    const file = await makeExport();
    const dbPath = path.join(dir, 'youtube-flix.db');
    const empty = openDb(dbPath);
    await auth.setPassword(empty, 'popcorn-night');
    empty.close();

    await expect(importCatalog({ file, dbPath })).rejects.toThrow(/household password.*--replace/s);

    const db = openDb(dbPath);
    expect(auth.hasPassword(db)).toBe(true);
    expect(titleNames(db)).toEqual([]);
    db.close();
  });

  it('refuses to import over its own source through a folder junction', async () => {
    const data = path.join(dir, 'data');
    mkdirSync(data);
    const dbPath = path.join(data, 'youtube-flix.db');
    await seedCatalog(dbPath);
    const alias = path.join(dir, 'alias');
    symlinkSync(data, alias, 'junction');

    await expect(importCatalog({ file: path.join(alias, 'youtube-flix.db'), dbPath, replace: true })).rejects.toThrow(
      CatalogTransferError,
    );
    const db = openDb(dbPath);
    expect(auth.hasPassword(db)).toBe(true);
    db.close();
  });

  it('refuses to import the catalog onto itself', async () => {
    const dbPath = path.join(dir, 'youtube-flix.db');
    await seedCatalog(dbPath);
    await expect(importCatalog({ file: dbPath, dbPath, replace: true })).rejects.toThrow(CatalogTransferError);
    expect(titleNames(openDb(dbPath))).toEqual(['Series A']);
  });
});

describe('importFailure: what the user is told when an import fails part-way', () => {
  const cause = new Error('disk full');
  const backup = 'C:\data\youtube-flix.db.backup-20261111-090000';

  it('before anything changed, passes the original error through', () => {
    expect(importFailure(cause, { placed: false, backup: null })).toBe(cause);
  });

  it('after the backup but before the swap, says the catalog was not replaced and where the copy is', () => {
    const err = importFailure(cause, { placed: false, backup });
    expect(err).toBeInstanceOf(CatalogTransferError);
    expect(err.message).toMatch(/disk full/);
    expect(err.message).toMatch(/was not replaced/);
    expect(err.message).toContain(backup);
  });

  it('after the swap, never claims the catalog was left alone, and points to the previous one', () => {
    const err = importFailure(cause, { placed: true, backup });
    expect(err.message).not.toMatch(/not replaced/);
    expect(err.message).toMatch(/was replaced/);
    expect(err.message).toContain(backup);
  });

  it('after the swap on a computer with no previous catalog, says so plainly', () => {
    const err = importFailure(cause, { placed: true, backup: null });
    expect(err.message).not.toMatch(/not replaced/);
    expect(err.message).toMatch(/was put in place/);
    expect(err.message).toMatch(/--replace/);
  });
});
