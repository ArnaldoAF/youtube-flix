import type { DB } from '../db.js';
import { NotFoundError } from '../errors.js';
import { collectionOf, collectionRefs, nextMovie, pruneCollections, type CollectionRef } from './collections.js';
import type { VideoMeta } from '../youtube/mapper.js';

export type TitleType = 'movie' | 'series';
export type DownloadStatus = 'none' | 'queued' | 'downloading' | 'paused' | 'done' | 'error';

export interface Progress {
  seconds: number;
  duration: number | null;
}

export interface Episode {
  id: number;
  seasonId: number;
  youtubeId: string;
  name: string;
  description: string;
  duration: number | null;
  thumbnail: string | null;
  position: number;
  uploadDate: string | null;
  downloadStatus: DownloadStatus;
  downloadError: string | null;
  fileSize: number | null;
  hasLocalFile: boolean;
  progress: Progress | null;
}

export interface Season {
  id: number;
  number: number;
  name: string;
  playlistId: string | null;
  episodes: Episode[];
}

export interface TitleSummary {
  id: number;
  type: TitleType;
  name: string;
  description: string;
  thumbnail: string | null;
  channel: string | null;
  tags: string[];
  featured: boolean;
  addedAt: string;
  seasonCount: number;
  episodeCount: number;
  totalDuration: number;
  downloadedCount: number;
  /** Set when this movie is part of a collection. */
  collection: CollectionRef | null;
}

export interface TitleDetail extends TitleSummary {
  sourceUrl: string;
  seasons: Season[];
}

type Row = Record<string, any>;

const EPISODE_SELECT = `
  SELECT e.*, p.seconds AS p_seconds, p.duration AS p_duration
  FROM episodes e LEFT JOIN progress p ON p.episode_id = e.id`;

function toEpisode(r: Row): Episode {
  return {
    id: r.id,
    seasonId: r.season_id,
    youtubeId: r.youtube_id,
    name: r.name,
    description: r.description,
    duration: r.duration,
    thumbnail: r.thumbnail,
    position: r.position,
    uploadDate: r.upload_date,
    downloadStatus: r.download_status,
    downloadError: r.download_error,
    fileSize: r.file_size,
    hasLocalFile: r.download_status === 'done' && Boolean(r.local_path),
    progress: r.p_seconds == null ? null : { seconds: r.p_seconds, duration: r.p_duration },
  };
}

function toSummary(r: Row, collection: CollectionRef | null): TitleSummary {
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    description: r.description,
    thumbnail: r.thumbnail,
    channel: r.channel,
    tags: JSON.parse(r.tags),
    featured: r.featured === 1,
    addedAt: r.added_at,
    seasonCount: r.season_count,
    episodeCount: r.episode_count,
    totalDuration: r.total_duration,
    downloadedCount: r.downloaded_count,
    collection,
  };
}

const SUMMARY_SELECT = `
  SELECT t.*,
    COUNT(DISTINCT s.id) AS season_count,
    COUNT(e.id) AS episode_count,
    COALESCE(SUM(e.duration), 0) AS total_duration,
    COALESCE(SUM(e.download_status = 'done'), 0) AS downloaded_count
  FROM titles t
  LEFT JOIN seasons s ON s.title_id = t.id
  LEFT JOIN episodes e ON e.season_id = s.id`;

// --- Titles ---

export interface NewTitle {
  type: TitleType;
  name: string;
  description: string;
  thumbnail: string | null;
  channel: string | null;
  sourceUrl: string;
}

export function createTitle(db: DB, t: NewTitle): number {
  const info = db
    .prepare(
      `INSERT INTO titles (type, name, description, thumbnail, channel, source_url)
       VALUES (@type, @name, @description, @thumbnail, @channel, @sourceUrl)`,
    )
    .run(t);
  return Number(info.lastInsertRowid);
}

export function listTitles(db: DB): TitleSummary[] {
  const refs = collectionRefs(db);
  return (db.prepare(`${SUMMARY_SELECT} GROUP BY t.id ORDER BY t.added_at DESC, t.id DESC`).all() as Row[]).map((r) =>
    toSummary(r, refs.get(r.id) ?? null),
  );
}

export function getTitle(db: DB, id: number): TitleDetail {
  const row = db.prepare(`${SUMMARY_SELECT} WHERE t.id = ? GROUP BY t.id`).get(id) as Row | undefined;
  if (!row) throw new NotFoundError('Title');
  const seasons = db.prepare('SELECT * FROM seasons WHERE title_id = ? ORDER BY number').all(id) as Row[];
  const episodes = (
    db
      .prepare(`${EPISODE_SELECT} JOIN seasons s ON s.id = e.season_id WHERE s.title_id = ? ORDER BY e.position`)
      .all(id) as Row[]
  ).map(toEpisode);
  return {
    ...toSummary(row, collectionOf(db, id)),
    sourceUrl: row.source_url,
    seasons: seasons.map((s) => ({
      id: s.id,
      number: s.number,
      name: s.name,
      playlistId: s.playlist_id,
      episodes: episodes.filter((e) => e.seasonId === s.id),
    })),
  };
}

export interface TitlePatch {
  name?: string;
  description?: string;
  tags?: string[];
  featured?: boolean;
  thumbnail?: string | null;
}

export function updateTitle(db: DB, id: number, patch: TitlePatch): void {
  const current = getTitle(db, id);
  db.prepare(
    `UPDATE titles SET name = ?, description = ?, tags = ?, featured = ?, thumbnail = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    patch.name ?? current.name,
    patch.description ?? current.description,
    JSON.stringify(patch.tags ?? current.tags),
    (patch.featured ?? current.featured) ? 1 : 0,
    patch.thumbnail === undefined ? current.thumbnail : patch.thumbnail,
    id,
  );
}

export function deleteTitle(db: DB, id: number): void {
  db.transaction(() => {
    const info = db.prepare('DELETE FROM titles WHERE id = ?').run(id);
    if (info.changes === 0) throw new NotFoundError('Title');
    // Its collection may now hold a single movie, which connects nothing.
    pruneCollections(db);
  })();
}

// --- Seasons & episodes ---

export interface NewSeason {
  titleId: number;
  number: number;
  name: string;
  playlistId: string | null;
  sourceUrl: string | null;
}

export function createSeason(db: DB, s: NewSeason): number {
  const info = db
    .prepare(
      `INSERT INTO seasons (title_id, number, name, playlist_id, source_url)
       VALUES (@titleId, @number, @name, @playlistId, @sourceUrl)`,
    )
    .run(s);
  return Number(info.lastInsertRowid);
}

export function nextSeasonNumber(db: DB, titleId: number): number {
  const row = db.prepare('SELECT MAX(number) AS n FROM seasons WHERE title_id = ?').get(titleId) as Row;
  return (row.n ?? 0) + 1;
}

export function seasonsOf(db: DB, titleId: number): Row[] {
  return db.prepare('SELECT * FROM seasons WHERE title_id = ? ORDER BY number').all(titleId) as Row[];
}

/** Inserts new episodes and refreshes metadata/order of existing ones. Returns the new episode ids. */
export function upsertEpisodes(db: DB, seasonId: number, metas: VideoMeta[]): number[] {
  const existing = new Set(
    (db.prepare('SELECT youtube_id FROM episodes WHERE season_id = ?').all(seasonId) as Row[]).map(
      (r) => r.youtube_id,
    ),
  );
  const upsert = db.prepare(
    `INSERT INTO episodes (season_id, youtube_id, name, description, duration, thumbnail, position, upload_date)
     VALUES (@seasonId, @youtubeId, @title, @description, @duration, @thumbnail, @position, @uploadDate)
     ON CONFLICT (season_id, youtube_id) DO UPDATE SET
       name = excluded.name,
       description = CASE WHEN excluded.description <> '' THEN excluded.description ELSE episodes.description END,
       duration = COALESCE(excluded.duration, episodes.duration),
       thumbnail = excluded.thumbnail,
       position = excluded.position,
       upload_date = COALESCE(excluded.upload_date, episodes.upload_date)
     RETURNING id`,
  );
  return metas.flatMap((m, i) => {
    const { id } = upsert.get({ ...m, seasonId, position: i + 1 }) as Row;
    return existing.has(m.youtubeId) ? [] : [id as number];
  });
}

export interface EpisodeContext {
  episode: Episode;
  localPath: string | null;
  title: { id: number; name: string; type: TitleType; thumbnail: string | null };
  season: { id: number; number: number; name: string };
  nextEpisodeId: number | null;
  /** Set when `nextEpisodeId` starts the next movie of a collection rather than this title. */
  nextTitle: { id: number; name: string } | null;
}

export function getEpisode(db: DB, id: number): EpisodeContext {
  const r = db
    .prepare(
      `${EPISODE_SELECT}
       JOIN seasons s ON s.id = e.season_id
       JOIN titles t ON t.id = s.title_id
       WHERE e.id = ?`,
    )
    .get(id) as Row | undefined;
  if (!r) throw new NotFoundError('Episode');
  const extra = db
    .prepare(
      `SELECT s.id AS s_id, s.number AS s_number, s.name AS s_name,
              t.id AS t_id, t.name AS t_name, t.type AS t_type, t.thumbnail AS t_thumbnail
       FROM seasons s JOIN titles t ON t.id = s.title_id WHERE s.id = ?`,
    )
    .get(r.season_id) as Row;
  return {
    episode: toEpisode(r),
    localPath: r.local_path,
    title: { id: extra.t_id, name: extra.t_name, type: extra.t_type, thumbnail: extra.t_thumbnail },
    season: { id: extra.s_id, number: extra.s_number, name: extra.s_name },
    ...nextUp(db, extra.t_id, extra.s_number, r.position),
  };
}

/** The next episode of this title, or after its last one, the first of the next movie in its collection. */
function nextUp(db: DB, titleId: number, seasonNumber: number, position: number): Pick<EpisodeContext, 'nextEpisodeId' | 'nextTitle'> {
  const sameTitle = nextEpisodeId(db, titleId, seasonNumber, position);
  if (sameTitle) return { nextEpisodeId: sameTitle, nextTitle: null };
  const movie = nextMovie(db, titleId);
  return movie ? { nextEpisodeId: movie.episodeId, nextTitle: { id: movie.titleId, name: movie.name } } : { nextEpisodeId: null, nextTitle: null };
}

export function nextEpisodeId(db: DB, titleId: number, seasonNumber: number, position: number): number | null {
  const row = db
    .prepare(
      `SELECT e.id FROM episodes e JOIN seasons s ON s.id = e.season_id
       WHERE s.title_id = ? AND (s.number > ? OR (s.number = ? AND e.position > ?))
       ORDER BY s.number, e.position LIMIT 1`,
    )
    .get(titleId, seasonNumber, seasonNumber, position) as Row | undefined;
  return row?.id ?? null;
}

export function episodeIdsOf(db: DB, scope: { titleId?: number; seasonId?: number }): number[] {
  const rows = scope.seasonId
    ? db.prepare('SELECT id FROM episodes WHERE season_id = ? ORDER BY position').all(scope.seasonId)
    : db
        .prepare(
          `SELECT e.id FROM episodes e JOIN seasons s ON s.id = e.season_id
           WHERE s.title_id = ? ORDER BY s.number, e.position`,
        )
        .all(scope.titleId);
  return (rows as Row[]).map((r) => r.id);
}

// --- Progress ---

export function saveProgress(db: DB, episodeId: number, seconds: number, duration: number | null): void {
  db.prepare(
    `INSERT INTO progress (episode_id, seconds, duration, updated_at)
     VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'))
     ON CONFLICT (episode_id) DO UPDATE SET seconds = excluded.seconds,
       duration = COALESCE(excluded.duration, progress.duration), updated_at = excluded.updated_at`,
  ).run(episodeId, seconds, duration);
}

export const isFinished = (p: Progress) => Boolean(p.duration) && p.seconds >= (p.duration as number) * 0.95;
const isStarted = (p: Progress) => p.seconds > 30;

export interface ContinueItem {
  episode: Episode;
  title: EpisodeContext['title'];
  seasonNumber: number;
}

/**
 * One entry per title: the most recently watched *started* episode (a few seconds of peeking at
 * another episode doesn't count), or the next one if that episode was finished.
 */
export function continueWatching(db: DB, limit = 20): ContinueItem[] {
  const rows = db
    .prepare(
      `SELECT e.id, s.title_id FROM progress p
       JOIN episodes e ON e.id = p.episode_id JOIN seasons s ON s.id = e.season_id
       WHERE p.seconds > 30
       ORDER BY p.updated_at DESC, p.episode_id DESC`,
    )
    .all() as Row[];
  const latestPerTitle = rows.filter((r, i) => rows.findIndex((x) => x.title_id === r.title_id) === i);
  // Titles the user has watched themselves: their own entry speaks for them, so a finished movie
  // never offers a sequel that already has progress of its own.
  const ownTitles = new Set(latestPerTitle.map((r) => r.title_id as number));

  const items = latestPerTitle
    .map((r) => getEpisode(db, r.id))
    .flatMap((ctx): ContinueItem[] => {
      const p = ctx.episode.progress;
      if (!p || !isStarted(p)) return [];
      if (!isFinished(p)) return [{ episode: ctx.episode, title: ctx.title, seasonNumber: ctx.season.number }];
      if (!ctx.nextEpisodeId) return [];
      const next = getEpisode(db, ctx.nextEpisodeId);
      if (next.title.id !== ctx.title.id && ownTitles.has(next.title.id)) return [];
      return [{ episode: next.episode, title: next.title, seasonNumber: next.season.number }];
    });
  // One entry per title offered, the most recent first.
  return items.filter((item, i) => items.findIndex((x) => x.title.id === item.title.id) === i).slice(0, limit);
}

/** Which episode "Play" should open for a title. */
export function playTarget(db: DB, titleId: number): number {
  const item = continueWatching(db, 1000).find((c) => c.title.id === titleId);
  if (item) return item.episode.id;
  const [first] = episodeIdsOf(db, { titleId });
  if (!first) throw new NotFoundError('Episode');
  return first;
}
