// Settings → Catalog: export a portable catalog file, preview an import, apply it. PC-only.
import express, { type NextFunction, type Request, type Response } from 'express';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { applyCatalogImport, ImportConflictError, previewCatalogImport, type ImportMode, type ImportSummary } from './catalogImport.js';
import type { DB } from './db.js';
import type { DownloadQueue } from './downloads/queue.js';
import * as store from './downloads/store.js';
import { HttpError } from './errors.js';
import { CatalogTransferError, exportCatalog, removeTempDir, stamp } from './transfer.js';

/** Emitted on the download queue after an import; the events stream passes it to every open page. */
export const CATALOG_CHANGED = 'catalog-changed';

/** A catalog is a few hundred KB; this leaves plenty of room without accepting anything huge. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const modeSchema = z.enum(['merge', 'replace']);

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Turns the import's own refusals into 409/400 answers the Settings page can show as they are. */
const handle = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  fn(req, res).catch((err) => {
    if (err instanceof ImportConflictError) return next(new HttpError(409, err.message));
    if (err instanceof CatalogTransferError) return next(new HttpError(400, err.message));
    next(err);
  });

/** Writes the uploaded bytes to a private temp file for the duration of `fn`. */
async function withUpload<T>(req: Request, fn: (file: string) => Promise<T>): Promise<T> {
  const body = req.body as unknown;
  if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, 'Choose a catalog file to import.');
  const dir = mkdtempSync(path.join(tmpdir(), 'ytf-upload-'));
  try {
    const file = path.join(dir, 'upload.db');
    writeFileSync(file, body);
    return await fn(file);
  } finally {
    removeTempDir(dir);
  }
}

export function catalogRoutes(db: DB, queue: DownloadQueue) {
  const api = express.Router();
  const upload = express.raw({ type: () => true, limit: MAX_UPLOAD_BYTES });
  const downloadsActive = () => queue.snapshot().length > 0 || store.hasActiveDownloads(db);
  const run = (go: typeof applyCatalogImport, changesCatalog: boolean) =>
    handle(async (req, res) => {
      const mode: ImportMode = modeSchema.parse(req.query.mode);
      const summary: ImportSummary = await withUpload(req, (file) => go(db, file, mode, { downloadsActive }));
      // Episode ids may have changed: every open page drops its live statuses and reloads.
      if (changesCatalog) queue.emit(CATALOG_CHANGED);
      res.json(summary);
    });

  api.get(
    '/catalog/export',
    handle(async (_req, res) => {
      // Read into memory and clean up before sending: a catalog is small, and no file stays open
      // for a cleanup callback to trip over once the download ends.
      const dir = mkdtempSync(path.join(tmpdir(), 'ytf-export-'));
      let bytes: Buffer;
      try {
        const file = path.join(dir, 'catalog.db');
        await exportCatalog(db.name, file);
        bytes = readFileSync(file);
      } finally {
        removeTempDir(dir);
      }
      res.attachment(`youtube-flix-catalog-${stamp(new Date()).slice(0, 8)}.db`).type('application/octet-stream').send(bytes);
    }),
  );
  api.post('/catalog/inspect', upload, run(previewCatalogImport, false));
  api.post('/catalog/import', upload, run(applyCatalogImport, true));

  return api;
}
