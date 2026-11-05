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

export function libraryUsage(db: DB): { files: number; bytes: number } {
  const r = db
    .prepare(
      `SELECT COUNT(*) AS files, COALESCE(SUM(file_size), 0) AS bytes FROM (
         SELECT DISTINCT local_path, file_size FROM episodes WHERE download_status = 'done' AND local_path IS NOT NULL)`,
    )
    .get() as Row;
  return { files: r.files, bytes: r.bytes };
}
