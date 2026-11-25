// Editing a series' episodes: their order, names, and removing the ones that do not belong.
import type { DB } from '../db.js';
import { HttpError, NotFoundError } from '../errors.js';

/**
 * How a season is ordered when its playlist is checked again:
 * - playlist: YouTube's order;
 * - reversed: YouTube's order upside down (for newest-first playlists);
 * - manual: the user's order is kept, and new videos are added at the end.
 */
export type OrderMode = 'playlist' | 'reversed' | 'manual';

type Row = Record<string, any>;

function seasonRow(db: DB, seasonId: number): { id: number; order_mode: OrderMode } {
  const row = db.prepare('SELECT id, order_mode FROM seasons WHERE id = ?').get(seasonId) as { id: number; order_mode: OrderMode } | undefined;
  if (!row) throw new NotFoundError('Season');
  return row;
}

const idsInOrder = (db: DB, seasonId: number): number[] =>
  (db.prepare('SELECT id FROM episodes WHERE season_id = ? ORDER BY position, id').all(seasonId) as Row[]).map((r) => r.id);

/** Numbers the season's episodes 1, 2, 3… in the given order. */
function renumber(db: DB, ids: number[]): void {
  const set = db.prepare('UPDATE episodes SET position = ? WHERE id = ?');
  ids.forEach((id, i) => set.run(i + 1, id));
}

/** Turns the season around. Playlist and reversed swap; a hand-made order stays hand-made. */
export function reverseSeason(db: DB, seasonId: number): void {
  db.transaction(() => {
    const { order_mode } = seasonRow(db, seasonId);
    renumber(db, idsInOrder(db, seasonId).reverse());
    const next: OrderMode = order_mode === 'playlist' ? 'reversed' : order_mode === 'reversed' ? 'playlist' : 'manual';
    db.prepare('UPDATE seasons SET order_mode = ? WHERE id = ?').run(next, seasonId);
  })();
}

/** Puts the season in the given order, which must list each of its episodes exactly once. */
export function reorderSeason(db: DB, seasonId: number, episodeIds: number[]): void {
  db.transaction(() => {
    seasonRow(db, seasonId);
    const current = idsInOrder(db, seasonId);
    const given = new Set(episodeIds);
    const same = given.size === episodeIds.length && given.size === current.length && current.every((id) => given.has(id));
    if (!same) throw new HttpError(400, 'The new order must list every episode of the season exactly once');
    renumber(db, episodeIds);
    db.prepare("UPDATE seasons SET order_mode = 'manual' WHERE id = ?").run(seasonId);
  })();
}

/** A new name or description. Marked as edited, so a playlist check keeps it. */
export function updateEpisode(db: DB, id: number, patch: { name?: string; description?: string }): void {
  const row = db.prepare('SELECT name, description FROM episodes WHERE id = ?').get(id) as Row | undefined;
  if (!row) throw new NotFoundError('Episode');
  db.prepare('UPDATE episodes SET name = ?, description = ?, edited = 1 WHERE id = ?').run(
    patch.name ?? row.name,
    patch.description ?? row.description,
    id,
  );
}

/** Throws when the episode cannot be removed. Checked before its downloaded file is touched. */
export function assertRemovable(db: DB, id: number): void {
  const row = db
    .prepare(
      `SELECT (SELECT COUNT(*) FROM episodes e2 JOIN seasons s2 ON s2.id = e2.season_id WHERE s2.title_id = s.title_id) AS total
       FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE e.id = ?`,
    )
    .get(id) as { total: number } | undefined;
  if (!row) throw new NotFoundError('Episode');
  if (row.total <= 1) throw new HttpError(400, 'This is the last episode; delete the whole title instead');
}

/**
 * Removes an episode and its watch progress, and remembers the video so a playlist check does not add
 * it back. The rest of the season is renumbered. Its downloaded file is the caller's business.
 */
export function removeEpisode(db: DB, id: number): void {
  db.transaction(() => {
    assertRemovable(db, id);
    const e = db.prepare('SELECT season_id, youtube_id, name FROM episodes WHERE id = ?').get(id) as Row;
    db.prepare(
      `INSERT INTO removed_videos (season_id, youtube_id, name) VALUES (?, ?, ?)
       ON CONFLICT (season_id, youtube_id) DO UPDATE SET name = excluded.name, removed_at = datetime('now')`,
    ).run(e.season_id, e.youtube_id, e.name);
    db.prepare('DELETE FROM episodes WHERE id = ?').run(id);
    renumber(db, idsInOrder(db, e.season_id));
  })();
}

/** Forgets a removal: the next playlist check adds the video again. */
export function restoreVideo(db: DB, seasonId: number, youtubeId: string): void {
  const info = db.prepare('DELETE FROM removed_videos WHERE season_id = ? AND youtube_id = ?').run(seasonId, youtubeId);
  if (info.changes === 0) throw new NotFoundError('Removed video');
}

export function removedVideos(db: DB, seasonId: number): { youtubeId: string; name: string }[] {
  return (db.prepare('SELECT youtube_id, name FROM removed_videos WHERE season_id = ? ORDER BY removed_at, youtube_id').all(seasonId) as Row[]).map(
    (r) => ({ youtubeId: r.youtube_id, name: r.name }),
  );
}
