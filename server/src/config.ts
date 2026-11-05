import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

export const SERVER_ROOT = path.resolve(here, '..');
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');
export const DATA_DIR = process.env.YTF_DATA_DIR ?? path.join(PROJECT_ROOT, 'data');
export const DB_PATH = path.join(DATA_DIR, 'youtube-flix.db');
export const DEFAULT_MEDIA_DIR = path.join(DATA_DIR, 'media');
export const BIN_DIR = path.join(SERVER_ROOT, 'bin');
export const CLIENT_DIST = path.join(PROJECT_ROOT, 'client', 'dist');

// Local-only by design: no auth exists, so never bind to other interfaces.
export const HOST = '127.0.0.1';
export const PORT = Number(process.env.PORT ?? 4000);
