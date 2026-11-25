import { z } from 'zod';
import type { DB } from '../db.js';
import { HttpError } from '../errors.js';
import { detectSeasonEpisode, groupBySeason, type PlaylistMeta, type VideoMeta } from '../youtube/mapper.js';
import { parseYoutubeUrl, playlistUrl, videoUrl, type ParsedUrl } from '../youtube/url.js';
import type { Fetcher } from '../youtube/ytdlp.js';
import * as repo from './repo.js';

export const importSchema = z.object({
  url: z.string().min(1).max(2000),
  type: z.enum(['movie', 'series']),
  /** When the link has both a video and a playlist, which one to import. Defaults to the playlist. */
  importAs: z.enum(['playlist', 'video']).optional(),
  /** For series playlists: one season, or the whole series (auto-split into seasons when possible). */
  seriesMode: z.enum(['season', 'series']).default('season'),
  /** Add as a new season of an existing series instead of creating a title. */
  seriesId: z.number().int().positive().optional(),
  seasonNumber: z.number().int().min(0).max(999).optional(),
  autoDownload: z.boolean().optional(),
});

export type ImportRequest = z.input<typeof importSchema>;

type Source = { kind: 'video'; video: VideoMeta } | { kind: 'playlist'; playlist: PlaylistMeta };

function choosePlaylist(parsed: ParsedUrl, importAs?: 'playlist' | 'video'): boolean {
  if (!parsed.playlistId) return false;
  if (!parsed.videoId) return true;
  return importAs !== 'video';
}

async function fetchSource(fetcher: Fetcher, parsed: ParsedUrl, importAs?: 'playlist' | 'video'): Promise<Source> {
  if (choosePlaylist(parsed, importAs)) {
    const playlist = await fetcher.fetchPlaylist(parsed.playlistId as string);
    if (playlist.entries.length === 0) throw new HttpError(422, 'This playlist has no available videos');
    return { kind: 'playlist', playlist };
  }
  return { kind: 'video', video: await fetcher.fetchVideo(parsed.videoId as string) };
}

export interface Preview {
  parsed: ParsedUrl;
  source: Source;
  /** Number of seasons found by title patterns (S01E02...) for "whole series" imports. */
  detectedSeasons: number | null;
}

export async function preview(fetcher: Fetcher, url: string, importAs?: 'playlist' | 'video'): Promise<Preview> {
  const parsed = parseYoutubeUrl(url);
  const source = await fetchSource(fetcher, parsed, importAs);
  const groups = source.kind === 'playlist' ? groupBySeason(source.playlist.entries) : null;
  return { parsed, source, detectedSeasons: groups?.size ?? null };
}

const seasonName = (type: repo.TitleType, n: number) => (type === 'movie' ? 'Parts' : `Season ${n}`);

function sourceInfo(source: Source) {
  return source.kind === 'playlist'
    ? {
        name: source.playlist.title,
        description: source.playlist.description || source.playlist.entries[0]?.description || '',
        thumbnail: source.playlist.thumbnail,
        channel: source.playlist.channel,
        url: playlistUrl(source.playlist.playlistId),
        playlistId: source.playlist.playlistId,
        entries: source.playlist.entries,
      }
    : {
        name: source.video.title,
        description: source.video.description,
        thumbnail: source.video.thumbnail,
        channel: source.video.channel,
        url: videoUrl(source.video.youtubeId),
        playlistId: null,
        entries: [source.video],
      };
}

export interface ImportResult {
  titleId: number;
  newEpisodeIds: number[];
}

export async function importTitle(db: DB, fetcher: Fetcher, input: ImportRequest): Promise<ImportResult> {
  const req = importSchema.parse(input);
  const parsed = parseYoutubeUrl(req.url);
  if (req.seriesId) assertSeries(db, req.seriesId);
  const source = await fetchSource(fetcher, parsed, req.importAs);
  const info = sourceInfo(source);

  return db.transaction((): ImportResult => {
    if (req.seriesId) {
      const number = req.seasonNumber ?? repo.nextSeasonNumber(db, req.seriesId);
      const seasonId = repo.createSeason(db, {
        titleId: req.seriesId,
        number,
        name: seasonName('series', number),
        playlistId: info.playlistId,
        sourceUrl: info.url,
      });
      return { titleId: req.seriesId, newEpisodeIds: repo.upsertEpisodes(db, seasonId, info.entries) };
    }

    const titleId = repo.createTitle(db, {
      type: req.type,
      name: info.name,
      description: info.description,
      thumbnail: info.thumbnail,
      channel: info.channel,
      sourceUrl: info.url,
    });
    const groups =
      req.type === 'series' && req.seriesMode === 'series' ? groupBySeason(info.entries) : null;
    const seasons = groups ?? new Map([[req.type === 'series' ? (req.seasonNumber ?? 1) : 1, info.entries]]);

    const newEpisodeIds = [...seasons.entries()].flatMap(([number, entries]) => {
      const seasonId = repo.createSeason(db, {
        titleId,
        number,
        name: seasonName(req.type, number),
        playlistId: info.playlistId,
        sourceUrl: info.url,
      });
      return repo.upsertEpisodes(db, seasonId, entries);
    });
    return { titleId, newEpisodeIds };
  })();
}

/**
 * What to auto-download after an import. Series start with just the first new episode, so adding
 * a long playlist doesn't fire dozens of requests at once (YouTube blocks bursts); the rest can be
 * downloaded from the title's "Download all" button. Movies download every part.
 */
export function autoDownloadIds(type: repo.TitleType, newEpisodeIds: number[]): number[] {
  return type === 'series' ? newEpisodeIds.slice(0, 1) : newEpisodeIds;
}

function assertSeries(db: DB, titleId: number): void {
  if (repo.getTitle(db, titleId).type !== 'series') {
    throw new HttpError(400, 'Seasons can only be added to a series');
  }
}

/**
 * Re-reads every playlist behind a title and adds new videos. Several seasons can share one
 * playlist ("whole series" imports); new videos go to the season their title points to.
 */
export async function refreshTitle(db: DB, fetcher: Fetcher, titleId: number): Promise<number[]> {
  const title = repo.getTitle(db, titleId);
  const byPlaylist = new Map<string, typeof title.seasons>();
  title.seasons
    .filter((s) => s.playlistId)
    .forEach((s) => byPlaylist.set(s.playlistId as string, [...(byPlaylist.get(s.playlistId as string) ?? []), s]));

  const playlists = await Promise.all(
    [...byPlaylist.keys()].map(async (id) => [id, await fetcher.fetchPlaylist(id)] as const),
  );

  return db.transaction(() =>
    playlists.flatMap(([playlistId, playlist]) => {
      const seasons = byPlaylist.get(playlistId) ?? [];
      const seasonOf = new Map(seasons.flatMap((s) => s.episodes.map((e) => [e.youtubeId, s.id] as const)));
      const assigned = new Map<number, VideoMeta[]>(seasons.map((s) => [s.id, []]));
      // A video removed from any season of this playlist stays out: it has no episode left to say
      // which season it was in, so it would otherwise land in another one.
      const removed = new Set(seasons.flatMap((s) => s.removed.map((r) => r.youtubeId)));

      playlist.entries.filter((entry) => !removed.has(entry.youtubeId)).forEach((entry) => {
        const seasonId = seasonOf.get(entry.youtubeId) ?? targetSeason(db, title, seasons, entry, playlistId);
        assigned.set(seasonId, [...(assigned.get(seasonId) ?? []), entry]);
      });
      return [...assigned.entries()].flatMap(([seasonId, entries]) => repo.upsertEpisodes(db, seasonId, entries));
    }),
  )();
}

function targetSeason(
  db: DB,
  title: repo.TitleDetail,
  seasons: repo.Season[],
  entry: VideoMeta,
  playlistId: string,
): number {
  const fallback = seasons[seasons.length - 1].id;
  if (seasons.length < 2) return fallback;
  const detected = detectSeasonEpisode(entry.title)?.season;
  if (detected === undefined) return fallback;
  const match = seasons.find((s) => s.number === detected);
  if (match) return match.id;
  if (title.seasons.some((s) => s.number === detected)) return fallback;
  const id = repo.createSeason(db, {
    titleId: title.id,
    number: detected,
    name: seasonName(title.type, detected),
    playlistId,
    sourceUrl: playlistUrl(playlistId),
  });
  seasons.push({ id, number: detected, name: '', playlistId, orderMode: 'playlist', removed: [], episodes: [] });
  return id;
}
