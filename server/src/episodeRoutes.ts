// Routes for editing a series' episodes. Reordering and renaming are open to the household;
// removing (which can delete a downloaded file) and restoring stay on this PC.
import express, { type Request } from 'express';
import { z } from 'zod';
import { assertRemovable, removeEpisode, reorderSeason, restoreVideo, reverseSeason, updateEpisode } from './catalog/episodes.js';
import * as repo from './catalog/repo.js';
import type { DB } from './db.js';
import type { DownloadQueue } from './downloads/queue.js';
import { NotFoundError } from './errors.js';
import { VIDEO_ID } from './youtube/url.js';

const idParam = (req: Request, name = 'id') => z.coerce.number().int().positive().parse(req.params[name]);

const orderSchema = z.object({ episodeIds: z.array(z.number().int().positive()).min(1).max(5000) });
const episodePatchSchema = z
  .object({
    name: z.string().trim().min(1).max(300).optional(),
    description: z.string().max(10_000).optional(),
  })
  .refine((v) => v.name !== undefined || v.description !== undefined, 'Nothing to change');

function titleOfSeason(db: DB, seasonId: number): repo.TitleDetail {
  const row = db.prepare('SELECT title_id FROM seasons WHERE id = ?').get(seasonId) as { title_id: number } | undefined;
  if (!row) throw new NotFoundError('Season');
  return repo.getTitle(db, row.title_id);
}

export function householdEpisodeRoutes(db: DB) {
  const api = express.Router();

  api.post('/seasons/:id/reverse', (req, res) => {
    const id = idParam(req);
    reverseSeason(db, id);
    res.json(titleOfSeason(db, id));
  });

  api.put('/seasons/:id/order', (req, res) => {
    const id = idParam(req);
    reorderSeason(db, id, orderSchema.parse(req.body).episodeIds);
    res.json(titleOfSeason(db, id));
  });

  api.patch('/episodes/:id', (req, res) => {
    const id = idParam(req);
    updateEpisode(db, id, episodePatchSchema.parse(req.body));
    res.json(titleOfSeason(db, repo.getEpisode(db, id).season.id));
  });

  return api;
}

export function pcOnlyEpisodeRoutes(db: DB, queue: DownloadQueue) {
  const api = express.Router();

  // ?keepFiles=true stops a download but leaves a finished file on disk, like deleting a title.
  api.delete('/episodes/:id', (req, res) => {
    const id = idParam(req);
    assertRemovable(db, id);
    if (req.query.keepFiles === 'true') queue.cancel(id);
    else queue.deleteFile(id);
    removeEpisode(db, id);
    res.status(204).end();
  });

  api.delete('/seasons/:id/removed/:youtubeId', (req, res) => {
    const id = idParam(req);
    const youtubeId = z.string().regex(VIDEO_ID, 'Not a YouTube video id').parse(req.params.youtubeId);
    restoreVideo(db, id, youtubeId);
    res.status(204).end();
  });

  return api;
}
