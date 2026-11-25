import Database from 'better-sqlite3';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS titles (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('movie', 'series')),
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  thumbnail   TEXT,
  channel     TEXT,
  source_url  TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]',
  featured    INTEGER NOT NULL DEFAULT 0,
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS seasons (
  id          INTEGER PRIMARY KEY,
  title_id    INTEGER NOT NULL REFERENCES titles(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL,
  name        TEXT NOT NULL,
  playlist_id TEXT,
  source_url  TEXT,
  order_mode  TEXT NOT NULL DEFAULT 'playlist' CHECK (order_mode IN ('playlist', 'reversed', 'manual')),
  UNIQUE (title_id, number)
);

CREATE TABLE IF NOT EXISTS episodes (
  id                 INTEGER PRIMARY KEY,
  season_id          INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  youtube_id         TEXT NOT NULL,
  name               TEXT NOT NULL,
  description        TEXT NOT NULL DEFAULT '',
  duration           INTEGER,
  thumbnail          TEXT,
  position           INTEGER NOT NULL,
  upload_date        TEXT,
  local_path         TEXT,
  file_size          INTEGER,
  download_status    TEXT NOT NULL DEFAULT 'none'
                     CHECK (download_status IN ('none', 'queued', 'downloading', 'paused', 'done', 'error')),
  download_error     TEXT,
  download_queued_at TEXT,
  edited             INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1)),
  UNIQUE (season_id, youtube_id)
);

-- Videos removed from a season by the user: a playlist check must not add them back.
CREATE TABLE IF NOT EXISTS removed_videos (
  season_id  INTEGER NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  youtube_id TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  removed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (season_id, youtube_id)
);
CREATE INDEX IF NOT EXISTS idx_episodes_status ON episodes(download_status);
CREATE INDEX IF NOT EXISTS idx_episodes_youtube ON episodes(youtube_id);

CREATE TABLE IF NOT EXISTS progress (
  episode_id INTEGER PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
  seconds    REAL NOT NULL,
  duration   REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Home-network access: one household password (scrypt) and login sessions (SHA-256 of the token).
CREATE TABLE IF NOT EXISTS auth (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL
);

-- Movie collections (sequels): separate movies in order. A movie is in at most one collection.
CREATE TABLE IF NOT EXISTS collections (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  title_id      INTEGER NOT NULL UNIQUE REFERENCES titles(id) ON DELETE CASCADE,
  position      INTEGER NOT NULL,
  PRIMARY KEY (collection_id, title_id)
);
`;

export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Columns added after the first release. CREATE TABLE IF NOT EXISTS skips tables that already exist. */
const ADDED_COLUMNS: { table: string; column: string; definition: string }[] = [
  {
    table: 'seasons',
    column: 'order_mode',
    definition: "TEXT NOT NULL DEFAULT 'playlist' CHECK (order_mode IN ('playlist', 'reversed', 'manual'))",
  },
  { table: 'episodes', column: 'edited', definition: 'INTEGER NOT NULL DEFAULT 0 CHECK (edited IN (0, 1))' },
];

function migrate(db: DB): void {
  ADDED_COLUMNS.forEach(({ table, column, definition }) => {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  });
}
