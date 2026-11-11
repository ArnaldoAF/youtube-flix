// Download-state queries on the episodes table.
import type { DB } from '../db.js';
import type { DownloadStatus } from '../catalog/repo.js';

type Row = Record<string, any>;

export interface DownloadRow {
  id: number;
  youtubeId: string;
  status: DownloadStatus;
  localPath: string | null;
}

const toRow = (r: Row): DownloadRow => ({
  id: r.id,
  youtubeId: r.youtube_id,
  status: r.download_status,
  localPath: r.local_path,
});

export function getDownloadRow(db: DB, id: number): DownloadRow | null {
  const r = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id) as Row | undefined;
  return r ? toRow(r) : null;
}

export function queuedRows(db: DB): DownloadRow[] {
  return (
    db
      .prepare("SELECT * FROM episodes WHERE download_status = 'queued' ORDER BY download_queued_at, id")
      .all() as Row[]
  ).map(toRow);
}

export function setStatus(db: DB, id: number, status: DownloadStatus, error: string | null = null): void {
  db.prepare(
    `UPDATE episodes SET download_status = ?, download_error = ?,
       download_queued_at = CASE WHEN ? = 'queued' THEN COALESCE(download_queued_at, datetime('now')) ELSE download_queued_at END
     WHERE id = ?`,
  ).run(status, error, status, id);
}

/** Marks every queued/downloading episode of this video as done (the same video can be in several titles). */
export function markDone(db: DB, youtubeId: string, localPath: string, fileSize: number): number[] {
  const rows = db
    .prepare(
      `UPDATE episodes SET download_status = 'done', local_path = ?, file_size = ?, download_error = NULL
       WHERE youtube_id = ? AND download_status IN ('queued', 'downloading', 'paused', 'error', 'none')
       RETURNING id`,
    )
    .all(localPath, fileSize, youtubeId) as Row[];
  return rows.map((r) => r.id);
}

export function clearFile(db: DB, id: number): void {
  db.prepare(
    `UPDATE episodes SET download_status = 'none', local_path = NULL, file_size = NULL,
       download_error = NULL, download_queued_at = NULL WHERE id = ?`,
  ).run(id);
}

/** A file already downloaded for this video by any episode. */
export function existingFile(db: DB, youtubeId: string): { localPath: string; fileSize: number } | null {
  const r = db
    .prepare(
      `SELECT local_path, file_size FROM episodes
       WHERE youtube_id = ? AND download_status = 'done' AND local_path IS NOT NULL LIMIT 1`,
    )
    .get(youtubeId) as Row | undefined;
  return r ? { localPath: r.local_path, fileSize: r.file_size } : null;
}

export function hasPending(db: DB, youtubeId: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM episodes WHERE youtube_id = ? AND download_status IN ('queued', 'downloading') LIMIT 1")
      .get(youtubeId),
  );
}

export function pathInUse(db: DB, localPath: string, exceptIds: number[] = []): boolean {
  const rows = db.prepare('SELECT id FROM episodes WHERE local_path = ?').all(localPath) as Row[];
  return rows.some((r) => !exceptIds.includes(r.id));
}

/** Anything downloading or waiting its turn. */
export function hasActiveDownloads(db: DB): boolean {
  return Boolean(db.prepare("SELECT 1 FROM episodes WHERE download_status IN ('queued', 'downloading') LIMIT 1").get());
}

/** After a restart, interrupted downloads go back to the queue. */
export function requeueInterrupted(db: DB): void {
  db.prepare("UPDATE episodes SET download_status = 'queued' WHERE download_status = 'downloading'").run();
}

export interface DownloadListItem {
  episodeId: number;
  episodeName: string;
  titleId: number;
  titleName: string;
  seasonNumber: number;
  titleType: string;
  thumbnail: string | null;
  status: DownloadStatus;
  error: string | null;
  fileSize: number | null;
  duration: number | null;
}

export function listDownloads(db: DB): DownloadListItem[] {
  return (
    db
      .prepare(
        `SELECT e.id, e.name, e.thumbnail, e.download_status, e.download_error, e.file_size, e.duration,
                s.number AS season_number, t.id AS title_id, t.name AS title_name, t.type AS title_type
         FROM episodes e JOIN seasons s ON s.id = e.season_id JOIN titles t ON t.id = s.title_id
         WHERE e.download_status <> 'none'
         ORDER BY CASE e.download_status WHEN 'downloading' THEN 0 WHEN 'queued' THEN 1 WHEN 'paused' THEN 2
                  WHEN 'error' THEN 3 ELSE 4 END, e.download_queued_at, e.id`,
      )
      .all() as Row[]
  ).map((r) => ({
    episodeId: r.id,
    episodeName: r.name,
    titleId: r.title_id,
    titleName: r.title_name,
    seasonNumber: r.season_number,
    titleType: r.title_type,
    thumbnail: r.thumbnail,
    status: r.download_status,
    error: r.download_error,
    fileSize: r.file_size,
    duration: r.duration,
  }));
}

export interface StorageTitleRef {
  id: number;
  name: string;
  type: 'movie' | 'series';
}

export interface StorageTitle extends StorageTitleRef {
  fileCount: number;
  /** Every file this title uses, including ones it shares with other titles. */
  bytes: number;
  /** What deleting this title's downloads actually frees: files no other title uses. */
  freeableBytes: number;
  /** Unfinished downloads that deleting would also cancel. */
  pendingCount: number;
  episodeIds: number[];
}

export interface StorageFile {
  name: string;
  bytes: number;
  /** Every episode using this file; all of them must go for the file to leave the disk. */
  episodeIds: number[];
  titles: StorageTitleRef[];
}

export interface StorageSummary {
  totalBytes: number;
  fileCount: number;
  split: { series: number; movie: number };
  titles: StorageTitle[];
  files: StorageFile[];
}

const toTitleRef = (r: Row): StorageTitleRef => ({ id: r.title_id, name: r.title_name, type: r.title_type });

const largestFirst = <T extends { bytes: number; name: string }>(items: T[]): T[] =>
  [...items].sort((a, b) => b.bytes - a.bytes || a.name.localeCompare(b.name));

/** One entry per file on disk. The same video in several titles is one file. */
function groupFiles(doneRows: Row[]): StorageFile[] {
  const byPath = new Map<string, Row[]>();
  doneRows.forEach((r) => byPath.set(r.local_path, [...(byPath.get(r.local_path) ?? []), r]));
  return [...byPath.values()].map((rows) => ({
    name: rows[0].name,
    bytes: rows[0].file_size ?? 0,
    episodeIds: rows.map((r) => r.id),
    titles: [...new Map(rows.map((r) => [r.title_id as number, toTitleRef(r)])).values()],
  }));
}

function summarizeTitle(ref: StorageTitleRef, rows: Row[], files: StorageFile[]): StorageTitle {
  const own = files.filter((f) => f.titles.some((t) => t.id === ref.id));
  const sumBytes = (list: StorageFile[]) => list.reduce((sum, f) => sum + f.bytes, 0);
  return {
    ...ref,
    fileCount: own.length,
    bytes: sumBytes(own),
    freeableBytes: sumBytes(own.filter((f) => f.titles.length === 1)),
    pendingCount: rows.filter((r) => r.download_status !== 'done').length,
    episodeIds: rows.map((r) => r.id),
  };
}

/** What the Storage page shows. Holds no file paths, because other devices can read it. */
export function storageSummary(db: DB): StorageSummary {
  const rows = db
    .prepare(
      `SELECT e.id, e.name, e.download_status, e.local_path, e.file_size,
              t.id AS title_id, t.name AS title_name, t.type AS title_type
       FROM episodes e JOIN seasons s ON s.id = e.season_id JOIN titles t ON t.id = s.title_id
       WHERE e.download_status <> 'none'
       ORDER BY t.id, e.id`,
    )
    .all() as Row[];
  const doneRows = rows.filter((r) => r.download_status === 'done' && r.local_path);
  const files = groupFiles(doneRows);
  const titleRefs = [...new Map(doneRows.map((r) => [r.title_id as number, toTitleRef(r)])).values()];
  // Rows are ordered by title, so a file shared across types counts for its oldest title and the split still adds up.
  const bytesOfType = (type: StorageTitleRef['type']) =>
    files.filter((f) => f.titles[0].type === type).reduce((sum, f) => sum + f.bytes, 0);

  return {
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    fileCount: files.length,
    split: { series: bytesOfType('series'), movie: bytesOfType('movie') },
    titles: largestFirst(
      titleRefs.map((ref) => summarizeTitle(ref, rows.filter((r) => r.title_id === ref.id), files)),
    ),
    files: largestFirst(files),
  };
}

export function libraryUsage(db: DB): { files: number; bytes: number } {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS files, COALESCE(SUM(file_size), 0) AS bytes FROM (
         SELECT DISTINCT local_path, file_size FROM episodes WHERE download_status = 'done' AND local_path IS NOT NULL)`,
    )
    .get() as Row;
  return { files: r.files, bytes: r.bytes };
}
