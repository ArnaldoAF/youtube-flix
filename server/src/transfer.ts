// Moving the catalog to another computer: titles, episodes, tags and watch progress travel;
// downloads, the household password and machine-specific settings stay behind.
import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, type DB } from './db.js';
import { PLAYLIST_ID, VIDEO_ID } from './youtube/url.js';

export class CatalogTransferError extends Error {}

export interface CatalogCounts {
  titles: number;
  episodes: number;
  withProgress: number;
}

interface Inspection {
  counts: CatalogCounts;
  hasPassword: boolean;
}

const REQUIRED_TABLES = ['titles', 'seasons', 'episodes', 'progress', 'settings'];

/** Settings tied to one computer: its download folder, its network role, its browser. */
const MACHINE_SETTINGS = ['mediaDir', 'network', 'cookiesFromBrowser'];

const SIDE_SUFFIXES = ['-wal', '-shm', '-journal'];

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Removes a temp folder without ever throwing. Windows can hold a just-closed file for a moment, and a
 * cleanup failure must not turn a finished job into an error, or crash the server from a callback.
 */
export function removeTempDir(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Left for the system's own temp cleanup.
  }
}

// --- Telling files apart by what they are, not how they are spelled ---

/** Real folder (junctions and symlinks resolved) plus the name, case-folded where the file system ignores case. */
function canonical(file: string): string {
  const resolved = path.resolve(file);
  let dir = path.dirname(resolved);
  try {
    dir = realpathSync.native(dir);
  } catch {
    // The folder does not exist yet, so nothing in it can be the catalog.
  }
  const full = path.join(dir, path.basename(resolved));
  return process.platform === 'win32' ? full.toLowerCase() : full;
}

/** Same on-disk file, which also catches hard links and 8.3 short names. Null when it does not exist. */
function fileIdentity(file: string): string | null {
  try {
    const s = statSync(file, { bigint: true });
    return s.ino ? `${s.dev}:${s.ino}` : null;
  } catch {
    return null;
  }
}

function isSameFile(a: string, b: string): boolean {
  if (canonical(a) === canonical(b)) return true;
  const id = fileIdentity(a);
  return id !== null && id === fileIdentity(b);
}

/** A database is several files on disk; none of `other`'s may be any of `catalog`'s. */
function assertSeparate(catalog: string, other: string, message: string): void {
  const filesOf = (f: string) => [f, ...SIDE_SUFFIXES.map((s) => `${f}${s}`)];
  if (filesOf(catalog).some((a) => filesOf(other).some((b) => isSameFile(a, b)))) throw new CatalogTransferError(message);
}

// --- Reading and cleaning catalogs ---

function readCounts(db: DB): CatalogCounts {
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  return { titles: count('titles'), episodes: count('episodes'), withProgress: count('progress') };
}

/** What a youtube-flix catalog holds, or null for anything else (missing, not SQLite, another app's database). */
function inspect(file: string): Inspection | null {
  let db: DB | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[];
    const tables = new Set(rows.map((r) => r.name));
    if (!REQUIRED_TABLES.every((t) => tables.has(t))) return null;
    const hasPassword = tables.has('auth') && (db.prepare('SELECT COUNT(*) AS n FROM auth').get() as { n: number }).n > 0;
    return { counts: readCounts(db), hasPassword };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/** A consistent copy, including changes still in the WAL, even while the app has the catalog open. */
async function snapshot(source: string, dest: string): Promise<void> {
  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
}

/** Strips everything that belongs to the old computer, and rewrites the file so deleted data is really gone. */
/**
 * A catalog file can come from anywhere, so its own triggers and views must never run here: they
 * would execute inside this process during the cleaning below. Dropped before any write.
 */
function dropExecutableObjects(db: DB): void {
  const objects = db.prepare("SELECT type, name FROM sqlite_master WHERE type IN ('trigger', 'view')").all() as { type: string; name: string }[];
  objects.forEach(({ type, name }) => db.exec(`DROP ${type === 'trigger' ? 'TRIGGER' : 'VIEW'} IF EXISTS "${name.replaceAll('"', '""')}"`));
}

const isWebUrl = (v: unknown) => typeof v === 'string' && /^https?:\/\/\S+$/i.test(v);
const isTagList = (v: unknown) => {
  try {
    const tags = JSON.parse(String(v));
    return Array.isArray(tags) && tags.every((t) => typeof t === 'string');
  } catch {
    return false;
  }
};

/**
 * Removes or blanks values the app would trust: video ids become file names, links become clickable
 * hrefs, numbers feed arithmetic. A title without a web link, an episode without a valid video id and
 * rows left without a parent are dropped; bad optional values become NULL.
 */
function dropUnsafeValues(db: DB): void {
  const flag = (fn: (v: unknown) => boolean) => (v: unknown) => (fn(v) ? 1 : 0);
  db.function('is_web_url', { deterministic: true }, flag(isWebUrl));
  db.function('is_video_id', { deterministic: true }, flag((v) => typeof v === 'string' && VIDEO_ID.test(v)));
  db.function('is_playlist_id', { deterministic: true }, flag((v) => typeof v === 'string' && PLAYLIST_ID.test(v)));
  db.function('is_tag_list', { deterministic: true }, flag(isTagList));
  const isNumber = (col: string) => `typeof(${col}) IN ('integer', 'real')`;
  db.exec(`
    DELETE FROM titles WHERE type NOT IN ('movie', 'series') OR NOT is_web_url(source_url);
    UPDATE titles SET thumbnail = NULL WHERE thumbnail IS NOT NULL AND NOT is_web_url(thumbnail);
    UPDATE titles SET tags = '[]' WHERE NOT is_tag_list(tags);
    DELETE FROM seasons WHERE title_id NOT IN (SELECT id FROM titles) OR NOT ${isNumber('number')};
    UPDATE seasons SET source_url = NULL WHERE source_url IS NOT NULL AND NOT is_web_url(source_url);
    UPDATE seasons SET playlist_id = NULL WHERE playlist_id IS NOT NULL AND NOT is_playlist_id(playlist_id);
    DELETE FROM episodes WHERE season_id NOT IN (SELECT id FROM seasons) OR NOT is_video_id(youtube_id);
    UPDATE episodes SET duration = NULL WHERE duration IS NOT NULL AND NOT ${isNumber('duration')};
    UPDATE episodes SET position = CAST(position AS INTEGER) WHERE typeof(position) <> 'integer';
    UPDATE episodes SET thumbnail = NULL WHERE thumbnail IS NOT NULL AND NOT is_web_url(thumbnail);
    DELETE FROM progress WHERE episode_id NOT IN (SELECT id FROM episodes) OR NOT ${isNumber('seconds')}
      OR (duration IS NOT NULL AND NOT ${isNumber('duration')});
  `);
}

function makePortable(file: string): CatalogCounts {
  const db = openDb(file);
  try {
    dropExecutableObjects(db);
    db.transaction(() => {
      dropUnsafeValues(db);
      db.prepare(
        `UPDATE episodes SET download_status = 'none', local_path = NULL, file_size = NULL,
           download_error = NULL, download_queued_at = NULL`,
      ).run();
      db.prepare('DELETE FROM auth').run();
      db.prepare('DELETE FROM sessions').run();
      db.prepare(`DELETE FROM settings WHERE key IN (${MACHINE_SETTINGS.map(() => '?').join(', ')})`).run(...MACHINE_SETTINGS);
    })();
    db.pragma('journal_mode = DELETE');
    db.exec('VACUUM');
    return readCounts(db);
  } finally {
    db.close();
  }
}

/**
 * Builds the portable file in the system temp folder, so the unstripped snapshot never sits in the
 * project or next to the destination. The caller removes `dir`.
 */
async function buildPortable(source: string, tmpRoot: string): Promise<{ file: string; dir: string; counts: CatalogCounts }> {
  const dir = mkdtempSync(path.join(tmpRoot, 'ytf-catalog-'));
  const file = path.join(dir, 'catalog.db');
  try {
    await snapshot(source, file);
    return { file, dir, counts: makePortable(file) };
  } catch (err) {
    removeTempDir(dir);
    throw err;
  }
}

/** Puts a finished file at `dest` in one step. A leftover from a crash holds only portable data. */
function place(built: string, dest: string): void {
  const staging = `${dest}.tmp-${process.pid}`;
  try {
    copyFileSync(built, staging);
    renameSync(staging, dest);
  } catch (err) {
    try {
      rmSync(staging, { force: true });
    } catch {
      // The original error matters more than a leftover staging file.
    }
    throw err;
  }
}

/** A stripped, validated copy of any catalog file, built in `tmpRoot`. The caller removes `dir`. */
export async function preparePortable(
  file: string,
  tmpRoot: string = tmpdir(),
): Promise<{ file: string; dir: string; counts: CatalogCounts }> {
  if (!existsSync(file) || !inspect(file)) throw new CatalogTransferError('That file is not a youtube-flix catalog.');
  return buildPortable(file, tmpRoot);
}

// --- Export ---

export interface TransferOptions {
  /** Where the unstripped snapshot is built. Defaults to the system temp folder; tests pass their own. */
  tmpRoot?: string;
}

export async function exportCatalog(source: string, dest: string, { tmpRoot = tmpdir() }: TransferOptions = {}): Promise<CatalogCounts> {
  if (!existsSync(source)) throw new CatalogTransferError(`No catalog found at ${source}`);
  assertSeparate(source, dest, 'Choose a different file name: that is the catalog itself.');
  if (!inspect(source)) throw new CatalogTransferError(`${source} is not a youtube-flix catalog`);

  mkdirSync(path.dirname(dest), { recursive: true });
  const built = await buildPortable(source, tmpRoot);
  try {
    place(built.file, dest);
    // Side files of an older export at this name would otherwise be read as part of the new one.
    SIDE_SUFFIXES.forEach((s) => rmSync(`${dest}${s}`, { force: true }));
    return built.counts;
  } finally {
    removeTempDir(built.dir);
  }
}

// --- Import ---

const pad = (n: number) => String(n).padStart(2, '0');
export const stamp = (d: Date) =>
  `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;

export function freePath(base: string): string {
  let candidate = base;
  for (let i = 2; existsSync(candidate); i += 1) candidate = `${base}-${i}`;
  return candidate;
}

/**
 * SQLite replays a -wal it finds next to a database without checking they belong together, which would
 * bring the old password and paths back. Moved aside rather than deleted: they may hold the only copy
 * of recent changes.
 */
function setAsideSideFiles(dbPath: string, now: Date): void {
  SIDE_SUFFIXES.forEach((s) => {
    const side = `${dbPath}${s}`;
    if (existsSync(side)) renameSync(side, freePath(`${side}.stale-${stamp(now)}`));
  });
}

function refuseOverwrite(dbPath: string, current: Inspection | null): void {
  const howTo = 'Run again with --replace to swap it for the imported one (a backup is kept).';
  if (current === null) throw new CatalogTransferError(`The current catalog at ${dbPath} cannot be read. ${howTo}`);
  if (current.counts.titles > 0) {
    throw new CatalogTransferError(`This computer's catalog already has ${plural(current.counts.titles, 'title')}. ${howTo}`);
  }
  if (current.hasPassword) {
    throw new CatalogTransferError(`This computer's catalog has a household password set, which the import would remove. ${howTo}`);
  }
}

/**
 * Backs up the catalog being replaced and makes it safe to swap. Leaving WAL mode needs the only
 * connection, so this fails while youtube-flix has the catalog open; when it succeeds, every change
 * is in the main file and SQLite has removed the side files, so none can be replayed onto the import.
 */
async function retire(dbPath: string, readable: boolean, now: Date): Promise<string> {
  const target = freePath(`${dbPath}.backup-${stamp(now)}`);
  if (!readable) {
    copyFileSync(dbPath, target);
    setAsideSideFiles(dbPath, now);
    return target;
  }
  const db = new Database(dbPath, { fileMustExist: true, timeout: 0 });
  try {
    let mode: unknown = null;
    try {
      mode = db.pragma('journal_mode = DELETE', { simple: true });
    } catch {
      // SQLITE_BUSY: another connection has it open.
    }
    if (mode !== 'delete') throw new CatalogTransferError('The catalog is in use. Quit youtube-flix, then import again.');
    await db.backup(target);
  } finally {
    db.close();
  }
  return target;
}

/** The success message must describe the file that is actually in place, not the one that was built. */
function assertPlacedAsBuilt(dbPath: string, built: CatalogCounts): void {
  const placed = inspect(dbPath);
  const matches =
    placed !== null &&
    !placed.hasPassword &&
    placed.counts.titles === built.titles &&
    placed.counts.episodes === built.episodes &&
    placed.counts.withProgress === built.withProgress;
  if (!matches) {
    throw new CatalogTransferError(`the catalog now at ${dbPath} does not match the imported file (check that folder for leftover files)`);
  }
}

/** What to tell the user depends on how far the import got: before or after the new file was put in place. */
export function importFailure(err: unknown, { placed, backup }: { placed: boolean; backup: string | null }): Error {
  const reason = err instanceof Error ? err.message : String(err);
  if (placed && backup) {
    return new CatalogTransferError(
      `Your catalog was replaced with the import, but the result did not pass the final check: ${reason}\nYour previous catalog is saved at ${backup}`,
    );
  }
  if (placed) {
    return new CatalogTransferError(
      `The imported catalog was put in place but did not pass the final check: ${reason}\nThere was no previous catalog. Run the import again with --replace once the cause is fixed.`,
    );
  }
  if (!backup) return err instanceof Error ? err : new Error(reason);
  return new CatalogTransferError(`Import failed: ${reason}\nThe catalog in use was not replaced. A copy of it was also saved at ${backup}`);
}

export interface ImportOptions extends TransferOptions {
  file: string;
  /** The catalog this computer uses, e.g. data/youtube-flix.db. */
  dbPath: string;
  /** Required when this computer's catalog has titles or a household password. */
  replace?: boolean;
  now?: Date;
}

export async function importCatalog({ file, dbPath, replace = false, now = new Date(), tmpRoot = tmpdir() }: ImportOptions): Promise<{
  counts: CatalogCounts;
  backup: string | null;
}> {
  if (!existsSync(file)) throw new CatalogTransferError(`Catalog file not found: ${file}`);
  assertSeparate(dbPath, file, 'That file is already the catalog this computer uses.');
  if (!inspect(file)) throw new CatalogTransferError(`${file} is not a youtube-flix catalog`);

  const hasCatalog = existsSync(dbPath);
  const current = hasCatalog ? inspect(dbPath) : null;
  if (hasCatalog && !replace) refuseOverwrite(dbPath, current);

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const built = await buildPortable(file, tmpRoot);
  let backup: string | null = null;
  let placed = false;
  try {
    backup = hasCatalog ? await retire(dbPath, current !== null, now) : null;
    if (!hasCatalog) setAsideSideFiles(dbPath, now);
    place(built.file, dbPath);
    placed = true;
    assertPlacedAsBuilt(dbPath, built.counts);
    return { counts: built.counts, backup };
  } catch (err) {
    throw importFailure(err, { placed, backup });
  } finally {
    removeTempDir(built.dir);
  }
}
