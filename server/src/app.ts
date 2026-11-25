import express, { type NextFunction, type Request, type Response } from 'express';
import { existsSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { z, ZodError } from 'zod';
import {
  hostGuard,
  loopbackOnly,
  markLocality,
  openAuthRoutes,
  passwordSchema,
  pcOnly,
  requireLogin,
  sameOriginWrites,
  type IsLocal,
} from './access.js';
import * as auth from './auth.js';
import * as repo from './catalog/repo.js';
import { CATALOG_CHANGED, catalogRoutes } from './catalogRoutes.js';
import { householdCollectionRoutes, pcOnlyCollectionRoutes } from './collectionRoutes.js';
import { householdEpisodeRoutes, pcOnlyEpisodeRoutes } from './episodeRoutes.js';
import { autoDownloadIds, importSchema, importTitle, preview, refreshTitle } from './catalog/service.js';
import { CLIENT_DIST, PORT } from './config.js';
import type { DB } from './db.js';
import type { DownloadQueue } from './downloads/queue.js';
import * as store from './downloads/store.js';
import { HttpError, NotFoundError } from './errors.js';
import { getSettings, saveSettings, settingsSchema } from './settings.js';
import { toolStatus, ytDlpPath } from './tools.js';
import { runYtDlp, type Fetcher } from './youtube/ytdlp.js';

export interface AppDeps {
  db: DB;
  fetcher: Fetcher;
  queue: DownloadQueue;
  /** Defaults to "the socket is loopback". Tests inject a fake to play a remote device. */
  isLocal?: IsLocal;
  /** Called after the response when Settings switches between 'local' and 'home'. */
  onNetworkChange?: (network: 'local' | 'home') => void;
  loginLimiter?: auth.LoginLimiter;
  /**
   * Set in dev mode (`npm run dev`): the pages come from Vite at this address, so this server
   * answers only /api and points anything else there instead of serving an old build.
   */
  devUiUrl?: string;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

function devPointer(url: string): string {
  const safe = escapeHtml(url);
  return `<!doctype html><meta charset="utf-8"><title>youtube-flix dev server</title>
<body style="font-family:system-ui,sans-serif;background:#141414;color:#fff;padding:2rem">
<p>This is the youtube-flix dev server. It only answers data requests.</p>
<p>Open the app at <a style="color:#e11d2a" href="${safe}">${safe}</a>.</p></body>`;
}

type Handler = (req: Request, res: Response) => unknown;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) =>
  Promise.resolve(fn(req, res)).catch(next);

const idParam = (req: Request, name = 'id') => z.coerce.number().int().positive().parse(req.params[name]);

const patchSchema = z.object({
  name: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(10_000).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  featured: z.boolean().optional(),
  thumbnail: z.string().url().max(2000).nullable().optional(),
});

const downloadSchema = z
  .object({
    episodeIds: z.array(z.number().int().positive()).max(5000).optional(),
    titleId: z.number().int().positive().optional(),
    seasonId: z.number().int().positive().optional(),
  })
  .refine((v) => v.episodeIds || v.titleId || v.seasonId, 'Nothing to download');

const deleteFilesSchema = z.object({
  episodeIds: z.array(z.number().int().positive()).min(1).max(5000),
});

export function createApp({ db, fetcher, queue, isLocal = loopbackOnly, onNetworkChange, loginLimiter, devUiUrl }: AppDeps) {
  const app = express();
  app.use(markLocality(isLocal));
  app.use(hostGuard());
  app.use(sameOriginWrites);
  app.use(express.json({ limit: '100kb' }));

  // Order matters: open auth routes, login wall, household routes, PC-only wall, PC-only routes.
  const api = express.Router();
  api.use(openAuthRoutes(db, loginLimiter ?? new auth.LoginLimiter()));
  api.use(requireLogin(db));
  api.use(householdRoutes(db, fetcher, queue));
  api.use(pcOnly);
  api.use(pcOnlyRoutes(db, queue, onNetworkChange));

  app.use('/api', api);
  app.use('/api', (_req, _res, next) => next(new NotFoundError('Endpoint')));

  if (devUiUrl) {
    app.use((req, res, next) =>
      req.method === 'GET' || req.method === 'HEAD' ? res.status(404).type('html').send(devPointer(devUiUrl)) : next(),
    );
  } else if (existsSync(CLIENT_DIST) && statSync(CLIENT_DIST).isDirectory()) {
    app.use(express.static(CLIENT_DIST));
    app.get('*', (_req, res) => res.sendFile(path.join(CLIENT_DIST, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

/** What other devices on the home network may use after signing in: watch, add, edit, queue downloads. */
function householdRoutes(db: DB, fetcher: Fetcher, queue: DownloadQueue) {
  const api = express.Router();

  // --- Catalog ---
  api.get('/titles', (_req, res) => res.json(repo.listTitles(db)));
  api.get('/titles/:id', (req, res) => res.json(repo.getTitle(db, idParam(req))));
  api.get('/titles/:id/play', (req, res) => res.json({ episodeId: repo.playTarget(db, idParam(req)) }));

  api.post(
    '/titles/preview',
    wrap(async (req, res) => {
      const body = z.object({ url: z.string().min(1).max(2000), importAs: z.enum(['playlist', 'video']).optional() });
      const { url, importAs } = body.parse(req.body);
      res.json(await preview(fetcher, url, importAs));
    }),
  );

  api.post(
    '/titles',
    wrap(async (req, res) => {
      const input = importSchema.parse(req.body);
      const result = await importTitle(db, fetcher, input);
      if (input.autoDownload ?? getSettings(db).autoDownload) {
        // The stored title decides, not the request: {type:'movie', seriesId} still adds to a series.
        queue.enqueue(autoDownloadIds(repo.getTitle(db, result.titleId).type, result.newEpisodeIds));
      }
      res.status(201).json(result);
    }),
  );

  api.post(
    '/titles/:id/refresh',
    wrap(async (req, res) => {
      const newIds = await refreshTitle(db, fetcher, idParam(req));
      if (getSettings(db).autoDownload) queue.enqueue(newIds);
      res.json({ newEpisodeIds: newIds });
    }),
  );

  api.patch('/titles/:id', (req, res) => {
    const id = idParam(req);
    repo.updateTitle(db, id, patchSchema.parse(req.body));
    res.json(repo.getTitle(db, id));
  });

  // --- Episodes & playback ---
  api.get('/episodes/:id', (req, res) => {
    const { localPath: _hidden, ...ctx } = repo.getEpisode(db, idParam(req));
    res.json(ctx);
  });

  api.get('/episodes/:id/stream', (req, res) => {
    const id = idParam(req);
    const { localPath, episode } = repo.getEpisode(db, id);
    if (!localPath || episode.downloadStatus !== 'done') throw new NotFoundError('Local file');
    if (!existsSync(localPath)) {
      store.clearFile(db, id);
      throw new NotFoundError('Local file');
    }
    res.sendFile(path.resolve(localPath), { acceptRanges: true });
  });

  api.put('/episodes/:id/progress', (req, res) => {
    const body = z.object({ seconds: z.number().min(0), duration: z.number().positive().nullable().optional() });
    const { seconds, duration } = body.parse(req.body);
    const id = idParam(req);
    repo.getEpisode(db, id);
    repo.saveProgress(db, id, seconds, duration ?? null);
    res.status(204).end();
  });

  api.get('/continue', (_req, res) => res.json(repo.continueWatching(db)));

  // --- Downloads ---
  api.get('/downloads', (_req, res) => res.json({ items: store.listDownloads(db), live: queue.snapshot() }));
  api.get('/downloads/storage', (_req, res) => res.json(store.storageSummary(db)));

  api.post('/downloads', (req, res) => {
    const { episodeIds, titleId, seasonId } = downloadSchema.parse(req.body);
    const ids = episodeIds ?? repo.episodeIdsOf(db, { titleId, seasonId });
    queue.enqueue(ids);
    res.status(202).json({ queued: ids.length });
  });

  api.post('/downloads/:id/:action', (req, res) => {
    const action = z.enum(['pause', 'resume', 'cancel']).parse(req.params.action);
    queue[action](idParam(req));
    res.status(204).end();
  });

  api.get('/downloads/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    queue.snapshot().forEach(send);
    queue.on('update', send);
    // A named event, so pages that only listen for download updates are not confused by it.
    const catalogChanged = () => res.write('event: catalog\ndata: {}\n\n');
    queue.on(CATALOG_CHANGED, catalogChanged);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      queue.off('update', send);
      queue.off(CATALOG_CHANGED, catalogChanged);
    });
  });

  api.use(householdCollectionRoutes(db));
  api.use(householdEpisodeRoutes(db));

  // --- Read-only settings & system ---
  api.get('/settings', (_req, res) => res.json(getSettings(db)));
  api.get(
    '/system',
    wrap(async (_req, res) => res.json({ tools: await toolStatus(), library: store.libraryUsage(db) })),
  );

  return api;
}

/** Destructive and administrative routes: settings, deletes, yt-dlp updates, password and network. */
function pcOnlyRoutes(db: DB, queue: DownloadQueue, onNetworkChange?: (network: 'local' | 'home') => void) {
  const api = express.Router();

  api.delete('/titles/:id', (req, res) => {
    const id = idParam(req);
    const keepFiles = req.query.keepFiles === 'true';
    repo.episodeIdsOf(db, { titleId: id }).forEach((epId) => (keepFiles ? queue.cancel(epId) : queue.deleteFile(epId)));
    repo.deleteTitle(db, id);
    res.status(204).end();
  });

  api.delete('/episodes/:id/file', (req, res) => {
    queue.deleteFile(idParam(req));
    res.status(204).end();
  });

  api.use(catalogRoutes(db, queue));
  api.use(pcOnlyCollectionRoutes(db));
  api.use(pcOnlyEpisodeRoutes(db, queue));

  api.delete('/downloads/files', (req, res) => {
    deleteFilesSchema.parse(req.body).episodeIds.forEach((id) => queue.deleteFile(id));
    res.status(204).end();
  });

  api.put('/settings', (req, res) => {
    const patch = settingsSchema.partial().parse(req.body);
    if (patch.network === 'home' && !auth.hasPassword(db)) {
      throw new HttpError(400, 'Set a password before turning on home network access');
    }
    const before = getSettings(db).network;
    const next = saveSettings(db, patch);
    // Re-binding drops open connections, so it waits until this response has gone out.
    if (next.network !== before) res.on('finish', () => onNetworkChange?.(next.network));
    res.json(next);
  });

  api.post(
    '/system/update-ytdlp',
    wrap(async (_req, res) => {
      const output = await runYtDlp(['-U'], 180_000);
      res.json({ output: output.trim(), path: ytDlpPath() });
    }),
  );

  api.put(
    '/auth/password',
    wrap(async (req, res) => {
      await auth.setPassword(db, passwordSchema.parse(req.body).password);
      res.status(204).end();
    }),
  );

  api.post('/auth/sign-out-all', (_req, res) => {
    auth.deleteAllSessions(db);
    res.status(204).end();
  });

  api.get('/network', (_req, res) => {
    const name = hostname();
    res.json({
      addresses: [
        ...auth.lanAddresses().map(({ name: adapter, address }) => ({ label: adapter, url: `http://${address}:${PORT}` })),
        { label: 'PC name', url: `http://${name}:${PORT}` },
      ],
    });
  });

  return api;
}

function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // body-parser errors (malformed JSON, body too large) carry their own 4xx status.
  const status = (err as { status?: number })?.status;
  if (!(err instanceof HttpError) && typeof status === 'number' && status >= 400 && status < 500) {
    return res.status(status).json({ error: status === 413 ? 'Request body too large' : 'Invalid request body' });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ') });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof Error && 'code' in err && String(err.code).startsWith('SQLITE_CONSTRAINT_UNIQUE')) {
    return res.status(409).json({ error: 'That season number already exists for this series' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}
