import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import * as repo from '../src/catalog/repo.js';
import { openDb, type DB } from '../src/db.js';
import type { DownloadQueue } from '../src/downloads/queue.js';
import type { VideoMeta } from '../src/youtube/mapper.js';
import type { Fetcher } from '../src/youtube/ytdlp.js';

const PL = 'PLabcdefghij12345';

const video = (id: string, title = id): VideoMeta => ({
  youtubeId: id.padEnd(11, 'x'),
  title,
  description: '',
  duration: 600,
  thumbnail: '',
  channel: null,
  uploadDate: null,
  chapters: [],
});

const fetcher: Fetcher = {
  fetchVideo: async (id) => video(id),
  fetchPlaylist: async (id) => ({
    playlistId: id,
    title: 'Playlist',
    description: '',
    channel: null,
    thumbnail: null,
    entries: [video('c', 'S02E01'), video('a', 'S01E01'), video('b', 'S01E02')],
  }),
};

let db: DB;
let server: Server;
let base: string;
let enqueued: number[][];

beforeEach(async () => {
  db = openDb(':memory:');
  enqueued = [];
  const queue = { enqueue: (ids: number[]) => enqueued.push(ids) } as unknown as DownloadQueue;
  server = createApp({ db, fetcher, queue }).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterEach(() => server.close());

const importTitle = (body: object) =>
  fetch(`${base}/titles`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(
    (r) => r.json() as Promise<{ titleId: number; newEpisodeIds: number[] }>,
  );

const nameOf = (id: number) => repo.getEpisode(db, id).episode.name;

describe('auto-download on import', () => {
  it('series: only the first episode (S1E1, even when the playlist starts with S2)', async () => {
    const { newEpisodeIds } = await importTitle({
      url: `https://www.youtube.com/playlist?list=${PL}`,
      type: 'series',
      seriesMode: 'series',
      autoDownload: true,
    });
    expect(newEpisodeIds).toHaveLength(3);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].map(nameOf)).toEqual(['S01E01']);
  });

  it('new season of an existing series: only its first episode', async () => {
    const { titleId } = await importTitle({ url: 'https://youtu.be/dQw4w9WgXcQ', type: 'series', autoDownload: false });
    await importTitle({ url: `https://www.youtube.com/playlist?list=${PL}`, type: 'series', seriesId: titleId, autoDownload: true });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toHaveLength(1);
  });

  it('uses the stored title type, not the request type, when adding to a series', async () => {
    const { titleId } = await importTitle({ url: 'https://youtu.be/dQw4w9WgXcQ', type: 'series', autoDownload: false });
    await importTitle({ url: `https://www.youtube.com/playlist?list=${PL}`, type: 'movie', seriesId: titleId, autoDownload: true });
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toHaveLength(1);
  });

  it('movie in parts: every part', async () => {
    const { newEpisodeIds } = await importTitle({
      url: `https://www.youtube.com/playlist?list=${PL}`,
      type: 'movie',
      autoDownload: true,
    });
    expect(enqueued).toEqual([newEpisodeIds]);
  });

  it('autoDownload off: nothing', async () => {
    await importTitle({ url: `https://www.youtube.com/playlist?list=${PL}`, type: 'series', autoDownload: false });
    expect(enqueued).toEqual([]);
  });
});
