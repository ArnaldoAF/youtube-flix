// Movie collections: separate movies that belong together in order (Part 1, Part 2…), without
// turning them into a series. Each movie keeps its own title; a movie is in at most one collection.
import type { DB } from '../db.js';
import { HttpError, NotFoundError } from '../errors.js';

export interface Collection {
  id: number;
  name: string;
  /** Movies in order. */
  titleIds: number[];
}

export interface CollectionRef {
  id: number;
  name: string;
  /** 1-based place of this movie in the collection. */
  position: number;
  size: number;
}

type Row = Record<string, any>;

export function listCollections(db: DB): Collection[] {
  const collections = db.prepare('SELECT id, name FROM collections ORDER BY name COLLATE NOCASE, id').all() as Row[];
  const items = db.prepare('SELECT collection_id, title_id FROM collection_items ORDER BY position, title_id').all() as Row[];
  return collections.map((c) => ({
    id: c.id,
    name: c.name,
    titleIds: items.filter((i) => i.collection_id === c.id).map((i) => i.title_id),
  }));
}

/** Every movie's place in its collection, for building title lists in one query. */
export function collectionRefs(db: DB): Map<number, CollectionRef> {
  const rows = db
    .prepare(
      `SELECT i.title_id, c.id, c.name,
              (SELECT COUNT(*) FROM collection_items o WHERE o.collection_id = c.id AND o.position < i.position) + 1 AS position,
              (SELECT COUNT(*) FROM collection_items o WHERE o.collection_id = c.id) AS size
       FROM collection_items i JOIN collections c ON c.id = i.collection_id`,
    )
    .all() as Row[];
  return new Map(rows.map((r) => [r.title_id as number, { id: r.id, name: r.name, position: r.position, size: r.size }]));
}

export function collectionOf(db: DB, titleId: number): CollectionRef | null {
  return collectionRefs(db).get(titleId) ?? null;
}

const cleanName = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) throw new HttpError(400, 'Give the collection a name');
  return trimmed.slice(0, 200);
};

/** Movies only, each once, at least two, all existing and not in another collection. */
function assertMembers(db: DB, titleIds: number[], ownCollectionId: number | null): void {
  if (new Set(titleIds).size !== titleIds.length) throw new HttpError(400, 'The same movie is listed twice');
  titleIds.forEach((id) => {
    const title = db.prepare('SELECT type FROM titles WHERE id = ?').get(id) as Row | undefined;
    if (!title) throw new NotFoundError(`Title ${id}`);
    if (title.type !== 'movie') throw new HttpError(400, 'Collections hold movies only; series already have seasons');
    const other = db
      .prepare('SELECT c.id, c.name FROM collection_items i JOIN collections c ON c.id = i.collection_id WHERE i.title_id = ?')
      .get(id) as Row | undefined;
    if (other && other.id !== ownCollectionId) throw new HttpError(409, `That movie is already in “${other.name}”`);
  });
}

function writeMembers(db: DB, collectionId: number, titleIds: number[]): void {
  db.prepare('DELETE FROM collection_items WHERE collection_id = ?').run(collectionId);
  const insert = db.prepare('INSERT INTO collection_items (collection_id, title_id, position) VALUES (?, ?, ?)');
  titleIds.forEach((titleId, i) => insert.run(collectionId, titleId, i + 1));
}

/** A collection with fewer than two movies connects nothing, so it goes. Movies are never touched. */
export function pruneCollections(db: DB): void {
  db.prepare('DELETE FROM collections WHERE id NOT IN (SELECT collection_id FROM collection_items GROUP BY collection_id HAVING COUNT(*) >= 2)').run();
}

export function createCollection(db: DB, name: string, titleIds: number[]): number {
  const clean = cleanName(name);
  if (titleIds.length < 2) throw new HttpError(400, 'A collection needs at least 2 movies');
  return db.transaction(() => {
    assertMembers(db, titleIds, null);
    const id = Number(db.prepare('INSERT INTO collections (name) VALUES (?)').run(clean).lastInsertRowid);
    writeMembers(db, id, titleIds);
    return id;
  })();
}

/** Renames and/or sets the full ordered list of movies. Fewer than two left removes the collection. */
export function updateCollection(db: DB, id: number, patch: { name?: string; titleIds?: number[] }): void {
  db.transaction(() => {
    if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) throw new NotFoundError('Collection');
    if (patch.name !== undefined) db.prepare('UPDATE collections SET name = ? WHERE id = ?').run(cleanName(patch.name), id);
    if (patch.titleIds !== undefined) {
      assertMembers(db, patch.titleIds, id);
      writeMembers(db, id, patch.titleIds);
      pruneCollections(db);
    }
  })();
}

export function deleteCollection(db: DB, id: number): void {
  const info = db.prepare('DELETE FROM collections WHERE id = ?').run(id);
  if (info.changes === 0) throw new NotFoundError('Collection');
}

/**
 * The first movie after `titleId` in its collection that has something to play, with its first
 * episode. A later movie without episodes is skipped.
 */
export function nextMovie(db: DB, titleId: number): { titleId: number; name: string; episodeId: number } | null {
  const next = db
    .prepare(
      `SELECT n.title_id, t.name FROM collection_items i
       JOIN collection_items n ON n.collection_id = i.collection_id AND n.position > i.position
       JOIN titles t ON t.id = n.title_id
       WHERE i.title_id = ?
         AND EXISTS (SELECT 1 FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE s.title_id = n.title_id)
       ORDER BY n.position LIMIT 1`,
    )
    .get(titleId) as Row | undefined;
  if (!next) return null;
  const first = db
    .prepare(
      `SELECT e.id FROM episodes e JOIN seasons s ON s.id = e.season_id
       WHERE s.title_id = ? ORDER BY s.number, e.position LIMIT 1`,
    )
    .get(next.title_id) as Row | undefined;
  return first ? { titleId: next.title_id, name: next.name, episodeId: first.id } : null;
}
