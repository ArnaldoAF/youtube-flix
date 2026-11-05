import { EventEmitter } from 'node:events';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as repo from '../src/catalog/repo.js';
import { openDb, type DB } from '../src/db.js';
import { DownloadQueue, type DownloadUpdate } from '../src/downloads/queue.js';
import { saveSettings } from '../src/settings.js';
import type { VideoMeta } from '../src/youtube/mapper.js';

class FakeProc extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = undefined;
  constructor(public args: string[]) {
    super();
  }
  outputTemplate() {
    return this.args[this.args.indexOf('-o') + 1];
  }
}

const meta = (id: string): VideoMeta => ({
  youtubeId: id,
  title: id,
  description: '',
  duration: 100,
  thumbnail: '',
  channel: null,
  uploadDate: null,
  chapters: [],
});

function setup(ids: string[]) {
  const db = openDb(':memory:');
  const mediaDir = mkdtempSync(path.join(tmpdir(), 'ytf-q-'));
  saveSettings(db, { mediaDir, concurrency: 1 });
  const titleId = repo.createTitle(db, { type: 'series', name: 'S', description: '', thumbnail: null, channel: null, sourceUrl: 'x' });
  const seasonId = repo.createSeason(db, { titleId, number: 1, name: 'Season 1', playlistId: null, sourceUrl: null });
  const episodeIds = repo.upsertEpisodes(db, seasonId, ids.map(meta));
  const procs: FakeProc[] = [];
  const queue = new DownloadQueue(db, (_cmd, args) => {
    const p = new FakeProc(args);
    procs.push(p);
    return p as unknown as ChildProcess;
  });
  const updates: DownloadUpdate[] = [];
  queue.on('update', (u) => updates.push(u));
  return { db, mediaDir, episodeIds, procs, queue, updates };
}

const status = (db: DB, id: number) => repo.getEpisode(db, id).episode.downloadStatus;

describe('DownloadQueue', () => {
  beforeEach(() => vi.useRealTimers());

  it('downloads one at a time, reports progress and marks done', () => {
    const { db, mediaDir, episodeIds: [a, b], procs, queue, updates } = setup(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    queue.enqueue([a, b]);
    expect(procs).toHaveLength(1);
    expect(status(db, a)).toBe('downloading');
    expect(status(db, b)).toBe('queued');

    procs[0].stdout.write('[download] Destination: x.f137.mp4\nYTF 50 100 NA 10 5\n');
    expect(updates.at(-1)).toMatchObject({ episodeId: a, percent: 50, stage: 1 });

    writeFileSync(path.join(mediaDir, 'aaaaaaaaaaa.mp4'), 'video');
    procs[0].emit('close', 0);
    expect(status(db, a)).toBe('done');
    expect(repo.getEpisode(db, a).episode.hasLocalFile).toBe(true);
    expect(procs).toHaveLength(2);
    expect(status(db, b)).toBe('downloading');
  });

  it('gives yt-dlp Node as its JavaScript runtime', () => {
    const { episodeIds: [a], procs, queue } = setup(['aaaaaaaaaaa']);
    queue.enqueue([a]);
    const i = procs[0].args.indexOf('--js-runtimes');
    expect(i).toBeGreaterThan(-1);
    expect(procs[0].args[i + 1]).toBe(`node:${process.execPath}`);
  });

  it('records yt-dlp errors', () => {
    const { db, episodeIds: [a], procs, queue } = setup(['aaaaaaaaaaa']);
    queue.enqueue([a]);
    procs[0].stderr.write('ERROR: [youtube] aaaaaaaaaaa: Video unavailable\n');
    procs[0].emit('close', 1);
    expect(repo.getEpisode(db, a).episode).toMatchObject({
      downloadStatus: 'error',
      downloadError: '[youtube] aaaaaaaaaaa: Video unavailable',
    });
  });

  it('pauses and resumes a running download', () => {
    const { db, episodeIds: [a], procs, queue } = setup(['aaaaaaaaaaa']);
    queue.enqueue([a]);
    queue.pause(a);
    procs[0].emit('close', 1);
    expect(status(db, a)).toBe('paused');
    queue.resume(a);
    expect(status(db, a)).toBe('downloading');
    expect(procs).toHaveLength(2);
  });

  it('cancel removes partial files', async () => {
    vi.useFakeTimers();
    const { db, mediaDir, episodeIds: [a], procs, queue } = setup(['aaaaaaaaaaa']);
    queue.enqueue([a]);
    writeFileSync(path.join(mediaDir, 'aaaaaaaaaaa.f137.mp4.part'), 'partial');
    writeFileSync(path.join(mediaDir, 'other.mp4'), 'keep');
    queue.cancel(a);
    procs[0].emit('close', 1);
    vi.advanceTimersByTime(2000);
    expect(status(db, a)).toBe('none');
    expect(readdirSync(mediaDir)).toEqual(['other.mp4']);
  });

  it('an unusable download folder marks the episode as error instead of crashing (restore too)', () => {
    const { db, mediaDir, episodeIds: [a, b], queue } = setup(['aaaaaaaaaaa', 'bbbbbbbbbbb']);
    const blocker = path.join(mediaDir, 'a-file');
    writeFileSync(blocker, 'x');
    // Bypasses saveSettings validation, like a drive that was unplugged after saving.
    db.prepare("UPDATE settings SET value = ? WHERE key = 'mediaDir'").run(JSON.stringify(path.join(blocker, 'media')));

    expect(() => queue.enqueue([a])).not.toThrow();
    expect(repo.getEpisode(db, a).episode).toMatchObject({ downloadStatus: 'error' });
    expect(repo.getEpisode(db, a).episode.downloadError).toMatch(/Could not start download/);

    db.prepare("UPDATE episodes SET download_status = 'queued' WHERE id = ?").run(b);
    expect(() => queue.restore()).not.toThrow();
    expect(status(db, b)).toBe('error');
  });

  it('cancel keeps partial files when another episode is about to download the same video', () => {
    vi.useFakeTimers();
    const { db, mediaDir, episodeIds: [a], procs, queue } = setup(['aaaaaaaaaaa']);
    const t2 = repo.createTitle(db, { type: 'movie', name: 'M', description: '', thumbnail: null, channel: null, sourceUrl: 'y' });
    const s2 = repo.createSeason(db, { titleId: t2, number: 1, name: 'Parts', playlistId: null, sourceUrl: null });
    const [dup] = repo.upsertEpisodes(db, s2, [meta('aaaaaaaaaaa')]);

    queue.enqueue([a, dup]);
    writeFileSync(path.join(mediaDir, 'aaaaaaaaaaa.f137.mp4.part'), 'partial');
    queue.cancel(a);
    procs[0].emit('close', 1);
    expect(status(db, dup)).toBe('downloading');
    vi.advanceTimersByTime(2000);
    expect(readdirSync(mediaDir)).toEqual(['aaaaaaaaaaa.f137.mp4.part']);
  });

  it('reuses an existing file when the same video is in two titles', () => {
    const { db, mediaDir, episodeIds: [a], procs, queue } = setup(['aaaaaaaaaaa']);
    queue.enqueue([a]);
    writeFileSync(path.join(mediaDir, 'aaaaaaaaaaa.mp4'), 'video');
    procs[0].emit('close', 0);

    const t2 = repo.createTitle(db, { type: 'movie', name: 'M', description: '', thumbnail: null, channel: null, sourceUrl: 'y' });
    const s2 = repo.createSeason(db, { titleId: t2, number: 1, name: 'Parts', playlistId: null, sourceUrl: null });
    const [dup] = repo.upsertEpisodes(db, s2, [meta('aaaaaaaaaaa')]);
    queue.enqueue([dup]);
    expect(procs).toHaveLength(1);
    expect(status(db, dup)).toBe('done');

    queue.deleteFile(a);
    expect(readdirSync(mediaDir)).toEqual(['aaaaaaaaaaa.mp4']);
    queue.deleteFile(dup);
    expect(readdirSync(mediaDir)).toEqual([]);
  });
});
