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
  UNIQUE (season_id, youtube_id)
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
`;

export function openDb(file: string): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
