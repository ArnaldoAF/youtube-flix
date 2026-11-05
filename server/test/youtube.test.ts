import { describe, expect, it } from 'vitest';
import { detectSeasonEpisode, groupBySeason, mapPlaylist, mapVideo, type VideoMeta } from '../src/youtube/mapper.js';
import { parseYoutubeUrl } from '../src/youtube/url.js';
import { formatFor, parseProgressLine } from '../src/downloads/progress.js';

describe('parseYoutubeUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['https://youtu.be/dQw4w9WgXcQ?t=10', 'dQw4w9WgXcQ', null],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ', null],
    ['https://www.youtube.com/playlist?list=PLabcdefghij12345', null, 'PLabcdefghij12345'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLabcdefghij12345', 'dQw4w9WgXcQ', 'PLabcdefghij12345'],
  ])('%s', (url, videoId, playlistId) => {
    expect(parseYoutubeUrl(url)).toEqual({ videoId, playlistId });
  });

  it('ignores auto-generated mixes', () => {
    expect(parseYoutubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDdQw4w9WgXcQ')).toEqual({
      videoId: 'dQw4w9WgXcQ',
      playlistId: null,
    });
  });

  it.each(['not a url', 'https://vimeo.com/123', 'javascript:alert(1)', 'https://youtube.com.evil.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=bad'])(
    'rejects %s',
    (url) => expect(() => parseYoutubeUrl(url)).toThrow(),
  );
});

describe('mapVideo / mapPlaylist', () => {
  it('maps a full video', () => {
    const v = mapVideo({
      id: 'abcdefghijk',
      title: 'Movie',
      duration: 5400,
      thumbnail: 'https://i.ytimg.com/vi/abcdefghijk/maxresdefault.jpg',
      uploader: 'Channel',
      upload_date: '20240131',
      chapters: [{ title: 'Intro', start_time: 0, end_time: 60 }],
    });
    expect(v).toMatchObject({ youtubeId: 'abcdefghijk', duration: 5400, channel: 'Channel', uploadDate: '2024-01-31' });
    expect(v.chapters).toHaveLength(1);
  });

  it('picks the largest thumbnail and falls back to hqdefault', () => {
    const big = mapVideo({
      id: 'abcdefghijk',
      thumbnails: [
        { url: 'https://x/small.jpg', width: 120, height: 90 },
        { url: 'https://x/big.jpg', width: 1280, height: 720 },
      ],
    });
    expect(big.thumbnail).toBe('https://x/big.jpg');
    expect(mapVideo({ id: 'abcdefghijk' }).thumbnail).toBe('https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg');
  });

  it('drops private and deleted playlist entries', () => {
    const p = mapPlaylist({
      id: 'PLabcdefghij12345',
      title: 'Series',
      entries: [
        { id: 'aaaaaaaaaaa', title: 'Ep 1', duration: 1200 },
        { id: 'bbbbbbbbbbb', title: '[Private video]' },
        { id: 'ccccccccccc', title: '[Deleted video]' },
      ],
    });
    expect(p.entries.map((e) => e.youtubeId)).toEqual(['aaaaaaaaaaa']);
    expect(p.thumbnail).toBe('https://i.ytimg.com/vi/aaaaaaaaaaa/hqdefault.jpg');
  });
});

describe('season detection', () => {
  it.each([
    ['Show S01E02 - Pilot', 1, 2],
    ['Show s2 e10', 2, 10],
    ['Série T1E3', 1, 3],
    ['Temporada 2 Episódio 5', 2, 5],
    ['Season 3 Episode 1', 3, 1],
    ['Show 1x02', 1, 2],
  ])('%s', (title, season, episode) => {
    expect(detectSeasonEpisode(title)).toEqual({ season, episode });
  });

  it('returns null for titles without markers', () => {
    expect(detectSeasonEpisode('Full movie 1080p')).toBeNull();
  });

  const meta = (title: string): VideoMeta => ({
    youtubeId: title,
    title,
    description: '',
    duration: null,
    thumbnail: '',
    channel: null,
    uploadDate: null,
    chapters: [],
  });

  it('groups by season, unmarked entries inherit the previous season', () => {
    const groups = groupBySeason(['S01E01', 'S01E02', 'Bonus', 'S02E01'].map(meta));
    expect(groups && [...groups.entries()].map(([n, e]) => [n, e.map((x) => x.title)])).toEqual([
      [1, ['S01E01', 'S01E02', 'Bonus']],
      [2, ['S02E01']],
    ]);
  });

  it('does not split when most titles have no marker', () => {
    expect(groupBySeason(['S01E01', 'Part 2', 'Part 3'].map(meta))).toBeNull();
  });
});

describe('progress lines', () => {
  it('parses a progress tick', () => {
    expect(parseProgressLine('YTF 500 1000 NA 250.5 2')).toEqual({
      downloaded: 500,
      total: 1000,
      percent: 50,
      speed: 250.5,
      eta: 2,
    });
  });

  it('uses the estimate when the total is unknown', () => {
    expect(parseProgressLine('YTF 250 NA 1000 NA NA')?.percent).toBe(25);
  });

  it('ignores other output', () => {
    expect(parseProgressLine('[download] Destination: x.mp4')).toBeNull();
  });

  it('caps quality at the chosen height and prefers H.264', () => {
    const f = formatFor(720);
    expect(f).toContain('[height<=720]');
    expect(f.split('/')[0]).toContain('[vcodec^=avc1]');
  });
});
