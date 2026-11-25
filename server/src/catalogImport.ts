// Importing a catalog into the running app, from Settings. The app keeps the catalog open, so instead
// of swapping files (the terminal import) this changes its contents in one transaction.
import { closeSync, existsSync, openSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { DB } from './db.js';
import { settingsSchema } from './settings.js';
import { CatalogTransferError, preparePortable, removeTempDir, stamp, type CatalogCounts } from './transfer.js';

export type ImportMode = 'merge' | 'replace';

export interface ImportSummary {
  mode: ImportMode;
  /** What the imported file holds. */
  incoming: CatalogCounts;
  addedTitles: number;
  /** Merge: existing titles that gained seasons, episodes or tags. */
  updatedTitles: number;
  addedEpisodes: number;
  progressUpdated: number;
  /** Replace: titles that were in the catalog before. */
  removedTitles: number;
  /** Episodes now pointing at a video this computer already had. */
  relinkedVideos: number;
  /** Replace: downloaded videos that stay on disk but are no longer in the catalog. */
  unlinked: { files: number; bytes: number };
  /** Collections created, or extended with movies, by this import. */
  collectionsAdded: number;
  backup: string | null;
}

/** The import cannot run right now; trying again later can succeed (HTTP 409). */
export class ImportConflictError extends CatalogTransferError {}
export class DownloadsActiveError extends ImportConflictError {}
export class ImportBusyError extends ImportConflictError {}

/** Catalogs with an import in progress. One at a time: each backup must hold what that import replaced. */
const importing = new WeakSet<DB>();

export interface LiveImportOptions {
  /** Checked again inside the transaction: a download can start while the file is prepared. */
  downloadsActive: boolean | (() => boolean);
  tmpRoot?: string;
  now?: Date;
}

type Row = Record<string, any>;
type Changes = Omit<ImportSummary, 'mode' | 'incoming' | 'backup'>;

/** Quality, simultaneous downloads and auto-download travel; folders, network and cookies never do. */
const PORTABLE_SETTINGS = ['maxHeight', 'concurrency', 'autoDownload'];

const TITLE_COLS = 'type, name, description, thumbnail, channel, source_url, tags, featured, added_at, updated_at';
const SEASON_COLS = 'title_id, number, name, playlist_id, source_url';
const EPISODE_COLS = 'season_id, youtube_id, name, description, duration, thumbnail, position, upload_date';

const noChanges = (): Changes => ({
  addedTitles: 0,
  updatedTitles: 0,
  addedEpisodes: 0,
  progressUpdated: 0,
  removedTitles: 0,
  relinkedVideos: 0,
  unlinked: { files: 0, bytes: 0 },
  collectionsAdded: 0,
});

const count = (db: DB, table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

function assertNoDownloads(mode: ImportMode, downloadsActive: LiveImportOptions['downloadsActive']): void {
  const active = typeof downloadsActive === 'function' ? downloadsActive() : downloadsActive;
  if (mode === 'replace' && active) {
    throw new DownloadsActiveError(
      'Pause or cancel downloads first. Replacing the catalog renumbers episodes, so a running download could end up on the wrong one.',
    );
  }
}

/** A downloaded file of this video that is still on disk, if this computer has one. */
function fileOf(db: DB, youtubeId: string): { local_path: string; file_size: number | null } | null {
  const r = db
    .prepare(
      `SELECT local_path, file_size FROM main.episodes
       WHERE youtube_id = ? AND download_status = 'done' AND local_path IS NOT NULL LIMIT 1`,
    )
    .get(youtubeId) as { local_path: string; file_size: number | null } | undefined;
  return r && existsSync(r.local_path) ? r : null;
}

function relink(db: DB, episodeId: number, file: { local_path: string; file_size: number | null }): void {
  db.prepare("UPDATE main.episodes SET download_status = 'done', local_path = ?, file_size = ? WHERE id = ?").run(
    file.local_path,
    file.file_size,
    episodeId,
  );
}

/** One stored setting is valid on its own. An invalid one must be skipped: getSettings would otherwise fall back to defaults for all of them. */
function isValidSetting({ key, value }: { key: string; value: string }): boolean {
  const schema = settingsSchema.shape[key as keyof typeof settingsSchema.shape];
  if (!schema) return false;
  try {
    return schema.safeParse(JSON.parse(value)).success;
  } catch {
    return false;
  }
}

function takePortableSettings(db: DB): void {
  const rows = db
    .prepare(`SELECT key, value FROM src.settings WHERE key IN (${PORTABLE_SETTINGS.map(() => '?').join(', ')})`)
    .all(...PORTABLE_SETTINGS) as { key: string; value: string }[];
  const upsert = db.prepare('INSERT INTO main.settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  rows.filter(isValidSetting).forEach((r) => upsert.run(r.key, r.value));
}

// --- Replace ---

function replace(db: DB): Changes {
  const removedTitles = count(db, 'main.titles');
  // Remembered before the rows go: the videos stay on disk either way.
  const kept = (
    db
      .prepare(
        `SELECT youtube_id, local_path, MAX(file_size) AS file_size FROM main.episodes
         WHERE download_status = 'done' AND local_path IS NOT NULL GROUP BY youtube_id`,
      )
      .all() as { youtube_id: string; local_path: string; file_size: number | null }[]
  ).filter((f) => existsSync(f.local_path));

  db.exec(`
    DELETE FROM main.collection_items; DELETE FROM main.collections;
    DELETE FROM main.progress; DELETE FROM main.episodes; DELETE FROM main.seasons; DELETE FROM main.titles;
    INSERT INTO main.titles (id, ${TITLE_COLS}) SELECT id, ${TITLE_COLS} FROM src.titles;
    INSERT INTO main.seasons (id, ${SEASON_COLS}) SELECT id, ${SEASON_COLS} FROM src.seasons;
    INSERT INTO main.episodes (id, ${EPISODE_COLS}) SELECT id, ${EPISODE_COLS} FROM src.episodes;
    INSERT INTO main.progress (episode_id, seconds, duration, updated_at) SELECT episode_id, seconds, duration, updated_at FROM src.progress;
    INSERT INTO main.collections (id, name) SELECT id, name FROM src.collections;
    INSERT INTO main.collection_items (collection_id, title_id, position) SELECT collection_id, title_id, position FROM src.collection_items;
  `);
  takePortableSettings(db);

  const changes = {
    ...noChanges(),
    removedTitles,
    addedTitles: count(db, 'main.titles'),
    addedEpisodes: count(db, 'main.episodes'),
    progressUpdated: count(db, 'main.progress'),
    collectionsAdded: count(db, 'main.collections'),
  };
  return kept.reduce((acc, f) => {
    const info = db
      .prepare("UPDATE main.episodes SET download_status = 'done', local_path = ?, file_size = ? WHERE youtube_id = ?")
      .run(f.local_path, f.file_size, f.youtube_id);
    return info.changes > 0
      ? { ...acc, relinkedVideos: acc.relinkedVideos + info.changes }
      : { ...acc, unlinked: { files: acc.unlinked.files + 1, bytes: acc.unlinked.bytes + (f.file_size ?? 0) } };
  }, changes);
}

// --- Merge ---

const parseTags = (json: string): string[] => {
  try {
    const tags = JSON.parse(json);
    return Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : [];
  } catch {
    return [];
  }
};

interface MergeState {
  changes: Changes;
  /** Imported episode id → id in this catalog. */
  episodeIds: Map<number, number>;
  newEpisodeIds: number[];
  /** Imported title id → id in this catalog. */
  titleIds: Map<number, number>;
}

/** Returns the matching title in this catalog, adding it when there is none. `true` when it already existed. */
function mergeTitle(db: DB, t: Row, state: MergeState): { titleId: number; existed: boolean; tagsChanged: boolean } {
  const match = db
    .prepare('SELECT id, tags FROM main.titles WHERE type = ? AND source_url = ? ORDER BY id LIMIT 1')
    .get(t.type, t.source_url) as { id: number; tags: string } | undefined;
  if (!match) {
    const info = db
      .prepare(`INSERT INTO main.titles (${TITLE_COLS}) SELECT ${TITLE_COLS} FROM src.titles WHERE id = ?`)
      .run(t.id);
    state.changes.addedTitles += 1;
    return { titleId: Number(info.lastInsertRowid), existed: false, tagsChanged: false };
  }
  const mine = parseTags(match.tags);
  const merged = [...mine, ...parseTags(t.tags).filter((tag) => !mine.includes(tag))];
  if (merged.length !== mine.length) {
    db.prepare("UPDATE main.titles SET tags = ?, updated_at = datetime('now') WHERE id = ?").run(JSON.stringify(merged), match.id);
  }
  return { titleId: match.id, existed: true, tagsChanged: merged.length !== mine.length };
}

/** Adds the seasons and episodes this catalog lacks. Returns whether anything was added. */
function mergeSeasons(db: DB, srcTitleId: number, titleId: number, state: MergeState): boolean {
  let added = false;
  const seasons = db.prepare('SELECT * FROM src.seasons WHERE title_id = ? ORDER BY number').all(srcTitleId) as Row[];
  seasons.forEach((s) => {
    const existing = db.prepare('SELECT id FROM main.seasons WHERE title_id = ? AND number = ?').get(titleId, s.number) as { id: number } | undefined;
    const seasonId =
      existing?.id ??
      Number(
        db
          .prepare(`INSERT INTO main.seasons (${SEASON_COLS}) SELECT ?, number, name, playlist_id, source_url FROM src.seasons WHERE id = ?`)
          .run(titleId, s.id).lastInsertRowid,
      );
    added = added || !existing;
    const episodes = db.prepare('SELECT id, youtube_id FROM src.episodes WHERE season_id = ? ORDER BY position, id').all(s.id) as Row[];
    episodes.forEach((e) => {
      const mine = db.prepare('SELECT id FROM main.episodes WHERE season_id = ? AND youtube_id = ?').get(seasonId, e.youtube_id) as { id: number } | undefined;
      if (mine) {
        state.episodeIds.set(e.id, mine.id);
        return;
      }
      const id = Number(
        db
          .prepare(
            `INSERT INTO main.episodes (${EPISODE_COLS})
             SELECT ?, youtube_id, name, description, duration, thumbnail, position, upload_date FROM src.episodes WHERE id = ?`,
          )
          .run(seasonId, e.id).lastInsertRowid,
      );
      state.episodeIds.set(e.id, id);
      state.newEpisodeIds.push(id);
      state.changes.addedEpisodes += 1;
      added = true;
    });
  });
  return added;
}

/** The most recently watched position wins; equal times change nothing, so a repeat import is a no-op. */
function mergeProgress(db: DB, state: MergeState): void {
  const rows = db.prepare('SELECT * FROM src.progress').all() as Row[];
  rows.forEach((p) => {
    const episodeId = state.episodeIds.get(p.episode_id);
    if (episodeId === undefined) return;
    const mine = db.prepare('SELECT updated_at FROM main.progress WHERE episode_id = ?').get(episodeId) as { updated_at: string } | undefined;
    if (mine && !(p.updated_at > mine.updated_at)) return;
    db.prepare(
      `INSERT INTO main.progress (episode_id, seconds, duration, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(episode_id) DO UPDATE SET seconds = excluded.seconds, duration = excluded.duration, updated_at = excluded.updated_at`,
    ).run(episodeId, p.seconds, p.duration, p.updated_at);
    state.changes.progressUpdated += 1;
  });
}

/**
 * A collection here with the same name gains the imported movies it lacks, at the end. Otherwise a new
 * one is created when at least two of its movies are free. A movie already in a collection on this
 * computer stays where it is.
 */
function mergeCollections(db: DB, state: MergeState): void {
  const collections = db.prepare('SELECT id, name FROM src.collections ORDER BY id').all() as Row[];
  const inAnyCollection = (titleId: number) => Boolean(db.prepare('SELECT 1 FROM main.collection_items WHERE title_id = ?').get(titleId));
  collections.forEach((c) => {
    const mapped = (db.prepare('SELECT title_id FROM src.collection_items WHERE collection_id = ? ORDER BY position, title_id').all(c.id) as Row[])
      .map((i) => state.titleIds.get(i.title_id))
      .filter((id): id is number => id !== undefined);
    // Two titles in the file can map to one movie here (same link): keep it once, at its first place.
    const members = [...new Set(mapped)];
    const free = members.filter((id) => !inAnyCollection(id));
    const mine = db.prepare('SELECT id FROM main.collections WHERE lower(trim(name)) = lower(trim(?)) ORDER BY id LIMIT 1').get(c.name) as Row | undefined;
    if (mine) {
      if (!free.length) return;
      const { last } = db.prepare('SELECT COALESCE(MAX(position), 0) AS last FROM main.collection_items WHERE collection_id = ?').get(mine.id) as Row;
      const insert = db.prepare('INSERT INTO main.collection_items (collection_id, title_id, position) VALUES (?, ?, ?)');
      free.forEach((titleId, i) => insert.run(mine.id, titleId, last + i + 1));
      state.changes.collectionsAdded += 1;
      return;
    }
    if (free.length < 2) return;
    const id = Number(db.prepare('INSERT INTO main.collections (name) VALUES (?)').run(c.name).lastInsertRowid);
    const insert = db.prepare('INSERT INTO main.collection_items (collection_id, title_id, position) VALUES (?, ?, ?)');
    free.forEach((titleId, i) => insert.run(id, titleId, i + 1));
    state.changes.collectionsAdded += 1;
  });
}

function merge(db: DB): Changes {
  const state: MergeState = { changes: noChanges(), episodeIds: new Map(), newEpisodeIds: [], titleIds: new Map() };
  const titles = db.prepare('SELECT id, type, source_url, tags FROM src.titles ORDER BY id').all() as Row[];
  titles.forEach((t) => {
    const { titleId, existed, tagsChanged } = mergeTitle(db, t, state);
    state.titleIds.set(t.id, titleId);
    const grew = mergeSeasons(db, t.id, titleId, state);
    if (existed && (grew || tagsChanged)) state.changes.updatedTitles += 1;
  });
  mergeCollections(db, state);
  mergeProgress(db, state);
  state.newEpisodeIds.forEach((id) => {
    const { youtube_id } = db.prepare('SELECT youtube_id FROM main.episodes WHERE id = ?').get(id) as { youtube_id: string };
    const file = fileOf(db, youtube_id);
    if (!file) return;
    relink(db, id, file);
    state.changes.relinkedVideos += 1;
  });
  return state.changes;
}

// --- Running it ---

class PreviewRollback extends Error {
  constructor(readonly changes: Changes) {
    super('preview');
  }
}

/** Claims a backup name by creating the file, so no other backup can ever be given the same one. */
function reserveBackupPath(base: string): string {
  for (let i = 1; ; i += 1) {
    const candidate = i === 1 ? base : `${base}-${i}`;
    try {
      closeSync(openSync(candidate, 'wx'));
      return candidate;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
}

async function backupLive(db: DB, now: Date): Promise<string> {
  const target = reserveBackupPath(`${db.name}.backup-${stamp(now)}`);
  await db.backup(target);
  return target;
}

/**
 * Prepares a stripped copy of the file, then merges or replaces inside one transaction. A preview runs
 * the very same steps and rolls them back, so its numbers are exactly what the import would do.
 */
async function run(db: DB, file: string, mode: ImportMode, options: LiveImportOptions, commit: boolean): Promise<ImportSummary> {
  if (!commit) return runOnce(db, file, mode, options, false);
  if (importing.has(db)) throw new ImportBusyError('Another catalog import is running. Try again when it has finished.');
  importing.add(db);
  try {
    return await runOnce(db, file, mode, options, true);
  } finally {
    importing.delete(db);
  }
}

async function runOnce(db: DB, file: string, mode: ImportMode, options: LiveImportOptions, commit: boolean): Promise<ImportSummary> {
  const { downloadsActive, tmpRoot = tmpdir(), now = new Date() } = options;
  assertNoDownloads(mode, downloadsActive);
  const built = await preparePortable(file, tmpRoot);
  try {
    const backup = commit ? await backupLive(db, now) : null;
    db.prepare('ATTACH DATABASE ? AS src').run(built.file);
    try {
      const apply = db.transaction(() => {
        assertNoDownloads(mode, downloadsActive);
        const changes = mode === 'merge' ? merge(db) : replace(db);
        if (!commit) throw new PreviewRollback(changes);
        return changes;
      });
      let changes: Changes;
      try {
        changes = apply();
      } catch (err) {
        if (!(err instanceof PreviewRollback)) throw err;
        changes = err.changes;
      }
      return { mode, incoming: built.counts, ...changes, backup };
    } finally {
      db.exec('DETACH DATABASE src');
    }
  } finally {
    removeTempDir(built.dir);
  }
}

export function previewCatalogImport(db: DB, file: string, mode: ImportMode, options: LiveImportOptions): Promise<ImportSummary> {
  return run(db, file, mode, options, false);
}

export function applyCatalogImport(db: DB, file: string, mode: ImportMode, options: LiveImportOptions): Promise<ImportSummary> {
  return run(db, file, mode, options, true);
}
