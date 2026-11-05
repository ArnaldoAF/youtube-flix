// Maps yt-dlp JSON (-J) into the shapes the catalog stores.
import { VIDEO_ID } from './url.js';

export interface Chapter {
  title: string;
  start: number;
  end: number;
}

export interface VideoMeta {
  youtubeId: string;
  title: string;
  description: string;
  duration: number | null;
  thumbnail: string;
  channel: string | null;
  uploadDate: string | null;
  chapters: Chapter[];
}

export interface PlaylistMeta {
  playlistId: string;
  title: string;
  description: string;
  channel: string | null;
  thumbnail: string | null;
  entries: VideoMeta[];
}

interface RawThumb {
  url?: string;
  width?: number;
  height?: number;
}

type Raw = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const UNAVAILABLE = /^\[(private|deleted) video\]$/i;

export const fallbackThumbnail = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export function bestThumbnail(raw: Raw): string | null {
  const thumbs = Array.isArray(raw.thumbnails) ? (raw.thumbnails as RawThumb[]) : [];
  const sized = thumbs
    .filter((t) => typeof t.url === 'string' && !t.url.endsWith('.webp'))
    .map((t) => ({ url: t.url as string, area: (t.width ?? 0) * (t.height ?? 0) }));
  const largest = sized.reduce<{ url: string; area: number } | null>(
    (best, t) => (!best || t.area >= best.area ? t : best),
    null,
  );
  return str(raw.thumbnail) ?? largest?.url ?? null;
}

function formatUploadDate(v: unknown): string | null {
  const s = str(v);
  return s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
}

function mapChapters(v: unknown): Chapter[] {
  if (!Array.isArray(v)) return [];
  return (v as Raw[])
    .filter((c) => num(c.start_time) !== null)
    .map((c) => ({
      title: str(c.title) ?? '',
      start: num(c.start_time) ?? 0,
      end: num(c.end_time) ?? 0,
    }));
}

export function mapVideo(raw: Raw): VideoMeta {
  const id = str(raw.id);
  // The id ends up in URLs and file names, so it is re-checked even though yt-dlp produced it.
  if (!id || !VIDEO_ID.test(id)) throw new Error(`yt-dlp returned an invalid video id: ${String(raw.id)}`);
  return {
    youtubeId: id,
    title: str(raw.title) ?? id,
    description: str(raw.description) ?? '',
    duration: num(raw.duration),
    thumbnail: bestThumbnail(raw) ?? fallbackThumbnail(id),
    channel: str(raw.channel) ?? str(raw.uploader),
    uploadDate: formatUploadDate(raw.upload_date),
    chapters: mapChapters(raw.chapters),
  };
}

export function isUnavailableEntry(raw: Raw): boolean {
  return !VIDEO_ID.test(str(raw.id) ?? '') || UNAVAILABLE.test(str(raw.title) ?? '');
}

export function mapPlaylist(raw: Raw): PlaylistMeta {
  const id = str(raw.id);
  if (!id) throw new Error('yt-dlp returned a playlist without an id');
  const entries = (Array.isArray(raw.entries) ? (raw.entries as Raw[]) : [])
    .filter((e) => e && !isUnavailableEntry(e))
    .map(mapVideo);
  return {
    playlistId: id,
    title: str(raw.title) ?? id,
    description: str(raw.description) ?? '',
    channel: str(raw.channel) ?? str(raw.uploader),
    thumbnail: entries[0]?.thumbnail ?? bestThumbnail(raw),
    entries,
  };
}

// --- Season detection for "whole series" playlists ---

const SEASON_PATTERNS = [
  /\b[st](\d{1,2})\s*[._ -]?\s*ep?\s*(\d{1,3})\b/i, // S01E02, S1 E2, T1E2, S01EP02
  /\b(?:season|temporada|temp\.?)\s*(\d{1,2})\D{0,20}?(?:episode|epis[oó]dio|ep\.?|cap[ií]tulo|cap\.?)\s*(\d{1,3})/i,
  /\b(\d{1,2})x(\d{2,3})\b/, // 1x02
];

export function detectSeasonEpisode(title: string): { season: number; episode: number } | null {
  for (const pattern of SEASON_PATTERNS) {
    const m = title.match(pattern);
    if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  }
  return null;
}

/**
 * Splits playlist entries into seasons when at least half of the titles carry a season marker.
 * Entries without a marker inherit the season of the entry before them. Returns null otherwise.
 */
export function groupBySeason(entries: VideoMeta[]): Map<number, VideoMeta[]> | null {
  const detected = entries.map((e) => detectSeasonEpisode(e.title));
  const matched = detected.filter(Boolean).length;
  if (entries.length === 0 || matched < entries.length / 2) return null;

  const groups = new Map<number, VideoMeta[]>();
  let current = detected.find(Boolean)?.season ?? 1;
  entries.forEach((entry, i) => {
    current = detected[i]?.season ?? current;
    groups.set(current, [...(groups.get(current) ?? []), entry]);
  });
  return new Map([...groups.entries()].sort(([a], [b]) => a - b));
}
