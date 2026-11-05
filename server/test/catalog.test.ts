import { beforeEach, describe, expect, it } from 'vitest';
import * as repo from '../src/catalog/repo.js';
import { importTitle, refreshTitle } from '../src/catalog/service.js';
import { openDb, type DB } from '../src/db.js';
import type { PlaylistMeta, VideoMeta } from '../src/youtube/mapper.js';
import type { Fetcher } from '../src/youtube/ytdlp.js';

const video = (id: string, title = id, duration = 600): VideoMeta => ({
  youtubeId: id.padEnd(11, 'x'),
  title,
  description: `about ${title}`,
  duration,
  thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  channel: 'Chan',
  uploadDate: null,
  chapters: [],
});

function fakeFetcher(playlists: Record<string, VideoMeta[]>): Fetcher & { playlists: typeof playlists } {
  return {
    playlists,
    fetchVideo: async (id) => video(id, `Video ${id}`, 5400),
    fetchPlaylist: async (id): Promise<PlaylistMeta> => ({
      playlistId: id,
      title: `Playlist ${id}`,
      description: '',
      channel: 'Chan',
      thumbnail: null,
      entries: playlists[id] ?? [],
    }),
  };
}

const PL = 'PLabcdefghij12345';
const PL2 = 'PLzyxwvutsrq98765';

describe('importTitle', () => {
  let db: DB;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('imports a single video as a movie', async () => {
    const f = fakeFetcher({});
    const { titleId, newEpisodeIds } = await importTitle(db, f, {
      url: 'https://youtu.be/dQw4w9WgXcQ',
      type: 'movie',
    });
    const t = repo.getTitle(db, titleId);
    expect(t).toMatchObject({ type: 'movie', name: 'Video dQw4w9WgXcQ', episodeCount: 1, totalDuration: 5400 });
    expect(newEpisodeIds).toHaveLength(1);
  });

  it('imports a playlist as one season of a series', async () => {
    const f = fakeFetcher({ [PL]: [video('a'), video('b'), video('c')] });
    const { titleId } = await importTitle(db, f, {
      url: `https://www.youtube.com/playlist?list=${PL}`,
      type: 'series',
      seriesMode: 'season',
    });
    const t = repo.getTitle(db, titleId);
    expect(t.seasons).toHaveLength(1);
    expect(t.seasons[0].episodes.map((e) => e.position)).toEqual([1, 2, 3]);
    expect(t.totalDuration).toBe(1800);
  });

  it('splits a whole-series playlist into seasons', async () => {
    const f = fakeFetcher({ [PL]: [video('a', 'S01E01'), video('b', 'S01E02'), video('c', 'S02E01')] });
    const { titleId } = await importTitle(db, f, {
      url: `https://www.youtube.com/playlist?list=${PL}`,
      type: 'series',
      seriesMode: 'series',
    });
    const t = repo.getTitle(db, titleId);
    expect(t.seasons.map((s) => [s.number, s.episodes.length])).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it('adds a playlist as the next season of an existing series', async () => {
    const f = fakeFetcher({ [PL]: [video('a')], [PL2]: [video('b'), video('c')] });
    const { titleId } = await importTitle(db, f, { url: `https://www.youtube.com/playlist?list=${PL}`, type: 'series' });
    await importTitle(db, f, { url: `https://www.youtube.com/playlist?list=${PL2}`, type: 'series', seriesId: titleId });
    const t = repo.getTitle(db, titleId);
    expect(t.seasons.map((s) => [s.number, s.name, s.episodes.length])).toEqual([
      [1, 'Season 1', 1],
      [2, 'Season 2', 2],
    ]);
  });

  it('refuses to add seasons to a movie', async () => {
    const f = fakeFetcher({ [PL]: [video('a')] });
    const { titleId } = await importTitle(db, f, { url: 'https://youtu.be/dQw4w9WgXcQ', type: 'movie' });
    await expect(
      importTitle(db, f, { url: `https://www.youtube.com/playlist?list=${PL}`, type: 'series', seriesId: titleId }),
    ).rejects.toThrow('only be added to a series');
  });

  it('prefers the playlist when the link has both, unless asked for the video', async () => {
    const f = fakeFetcher({ [PL]: [video('a'), video('b')] });
    const url = `https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=${PL}`;
    const both = await importTitle(db, f, { url, type: 'series' });
    const single = await importTitle(db, f, { url, type: 'movie', importAs: 'video' });
    expect(repo.getTitle(db, both.titleId).episodeCount).toBe(2);
    expect(repo.getTitle(db, single.titleId).episodeCount).toBe(1);
  });
});

describe('refreshTitle', () => {
  it('adds new playlist videos to the season their title points to', async () => {
    const db = openDb(':memory:');
    const f = fakeFetcher({ [PL]: [video('a', 'S01E01'), video('b', 'S02E01')] });
    const { titleId } = await importTitle(db, f, {
      url: `https://www.youtube.com/playlist?list=${PL}`,
      type: 'series',
      seriesMode: 'series',
    });
    f.playlists[PL] = [video('a', 'S01E01'), video('n', 'S01E02'), video('b', 'S02E01'), video('m', 'S03E01')];

    const newIds = await refreshTitle(db, f, titleId);
    const t = repo.getTitle(db, titleId);
    expect(newIds).toHaveLength(2);
    expect(t.seasons.map((s) => [s.number, s.episodes.map((e) => e.name)])).toEqual([
      [1, ['S01E01', 'S01E02']],
      [2, ['S02E01']],
      [3, ['S03E01']],
    ]);
  });
});

describe('progress & continue watching', () => {
  it('resumes in-progress episodes and moves to the next when finished', async () => {
    const db = openDb(':memory:');
    const f = fakeFetcher({ [PL]: [video('a'), video('b')] });
    const { titleId, newEpisodeIds: [first, second] } = await importTitle(db, f, {
      url: `https://www.youtube.com/playlist?list=${PL}`,
      type: 'series',
    });

    expect(repo.playTarget(db, titleId)).toBe(first);
    repo.saveProgress(db, first, 120, 600);
    expect(repo.continueWatching(db)[0].episode.id).toBe(first);

    repo.saveProgress(db, first, 590, 600);
    expect(repo.continueWatching(db)[0].episode.id).toBe(second);
    expect(repo.playTarget(db, titleId)).toBe(second);
    expect(repo.getEpisode(db, first).nextEpisodeId).toBe(second);
  });

  it('peeking at another episode for a few seconds keeps the started one', async () => {
    const db = openDb(':memory:');
    const f = fakeFetcher({ [PL]: [video('a'), video('b')] });
    const { titleId, newEpisodeIds: [first, second] } = await importTitle(db, f, {
      url: `https://www.youtube.com/playlist?list=${PL}`,
      type: 'series',
    });
    repo.saveProgress(db, first, 300, 600);
    repo.saveProgress(db, second, 10, 600);
    expect(repo.continueWatching(db).map((c) => c.episode.id)).toEqual([first]);
    expect(repo.playTarget(db, titleId)).toBe(first);
  });
});
