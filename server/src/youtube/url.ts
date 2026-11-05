import { InvalidUrlError } from '../errors.js';

const HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
  'www.youtube-nocookie.com',
]);
export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,64}$/;

export interface ParsedUrl {
  videoId: string | null;
  playlistId: string | null;
}

/** Extracts IDs from a YouTube link. Only these IDs (never the raw input) are passed to yt-dlp. */
export function parseYoutubeUrl(input: string): ParsedUrl {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new InvalidUrlError('This is not a valid link');
  }
  const host = url.hostname.toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || !HOSTS.has(host)) {
    throw new InvalidUrlError('Only YouTube links are supported');
  }

  let videoId: string | null = null;
  if (host === 'youtu.be') {
    videoId = url.pathname.slice(1).split('/')[0] || null;
  } else if (url.pathname === '/watch') {
    videoId = url.searchParams.get('v');
  } else {
    videoId = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([^/]+)/)?.[1] ?? null;
  }
  let playlistId = url.searchParams.get('list');

  if (videoId && !VIDEO_ID.test(videoId)) videoId = null;
  // "RD..." lists are auto-generated mixes, not real playlists.
  if (playlistId && (!PLAYLIST_ID.test(playlistId) || playlistId.startsWith('RD'))) playlistId = null;
  if (!videoId && !playlistId) throw new InvalidUrlError('No video or playlist found in this link');
  return { videoId, playlistId };
}

export const videoUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const playlistUrl = (id: string) => `https://www.youtube.com/playlist?list=${id}`;
