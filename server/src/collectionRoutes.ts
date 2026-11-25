// Movie collections over HTTP. Viewing, creating and editing are household actions, like editing a
// title; deleting a whole collection is PC-only, like other deletes.
import express from 'express';
import { z } from 'zod';
import { createCollection, deleteCollection, listCollections, updateCollection } from './catalog/collections.js';
import { suggestCollections } from './catalog/detect.js';
import * as repo from './catalog/repo.js';
import type { DB } from './db.js';

const idParam = (value: unknown) => z.coerce.number().int().positive().parse(value);
const titleIds = z.array(z.number().int().positive()).max(100);
const createSchema = z.object({ name: z.string().max(500), titleIds });
const updateSchema = z.object({ name: z.string().max(500).optional(), titleIds: titleIds.optional() });

export function householdCollectionRoutes(db: DB) {
  const api = express.Router();

  api.get('/collections', (_req, res) => res.json(listCollections(db)));

  api.get('/collections/suggestions', (_req, res) => {
    const inputs = repo.listTitles(db).map((t) => ({
      id: t.id,
      type: t.type,
      name: t.name,
      channel: t.channel,
      inCollection: t.collection !== null,
    }));
    res.json(suggestCollections(inputs));
  });

  api.post('/collections', (req, res) => {
    const { name, titleIds: ids } = createSchema.parse(req.body);
    res.status(201).json({ id: createCollection(db, name, ids) });
  });

  api.put('/collections/:id', (req, res) => {
    const id = idParam(req.params.id);
    updateCollection(db, id, updateSchema.parse(req.body));
    res.json(listCollections(db).find((c) => c.id === id) ?? null);
  });

  return api;
}

export function pcOnlyCollectionRoutes(db: DB) {
  const api = express.Router();
  api.delete('/collections/:id', (req, res) => {
    deleteCollection(db, idParam(req.params.id));
    res.status(204).end();
  });
  return api;
}
