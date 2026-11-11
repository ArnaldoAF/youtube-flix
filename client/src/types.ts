export type TitleType = 'movie' | 'series';
export type DownloadStatus = 'none' | 'queued' | 'downloading' | 'paused' | 'done' | 'error';

export interface Progress {
  seconds: number;
  duration: number | null;
}

export interface Episode {
  id: number;
  seasonId: number;
  youtubeId: string;
  name: string;
  description: string;
  duration: number | null;
  thumbnail: string | null;
  position: number;
  uploadDate: string | null;
  downloadStatus: DownloadStatus;
  downloadError: string | null;
  fileSize: number | null;
  hasLocalFile: boolean;
  progress: Progress | null;
}

export interface Season {
  id: number;
  number: number;
  name: string;
  playlistId: string | null;
  episodes: Episode[];
}

export interface TitleSummary {
  id: number;
  type: TitleType;
  name: string;
  description: string;
  thumbnail: string | null;
  channel: string | null;
  tags: string[];
  featured: boolean;
  addedAt: string;
  seasonCount: number;
  episodeCount: number;
  totalDuration: number;
  downloadedCount: number;
}

export interface TitleDetail extends TitleSummary {
  sourceUrl: string;
  seasons: Season[];
}

export interface TitleRef {
  id: number;
  name: string;
  type: TitleType;
  thumbnail: string | null;
}

export interface ContinueItem {
  episode: Episode;
  title: TitleRef;
  seasonNumber: number;
}

export interface EpisodeContext {
  episode: Episode;
  title: TitleRef;
  season: { id: number; number: number; name: string };
  nextEpisodeId: number | null;
}

export interface VideoMeta {
  youtubeId: string;
  title: string;
  description: string;
  duration: number | null;
  thumbnail: string;
  channel: string | null;
}

export interface Preview {
  parsed: { videoId: string | null; playlistId: string | null };
  source:
    | { kind: 'video'; video: VideoMeta }
    | { kind: 'playlist'; playlist: { playlistId: string; title: string; description: string; channel: string | null; thumbnail: string | null; entries: VideoMeta[] } };
  detectedSeasons: number | null;
}

export interface DownloadUpdate {
  episodeId: number;
  status: DownloadStatus;
  percent: number | null;
  speed: number | null;
  eta: number | null;
  stage: number | 'merging' | null;
  error: string | null;
}

export interface DownloadItem {
  episodeId: number;
  episodeName: string;
  titleId: number;
  titleName: string;
  seasonNumber: number;
  titleType: TitleType;
  thumbnail: string | null;
  status: DownloadStatus;
  error: string | null;
  fileSize: number | null;
  duration: number | null;
}

export interface StorageTitleRef {
  id: number;
  name: string;
  type: TitleType;
}

export interface StorageTitle extends StorageTitleRef {
  fileCount: number;
  bytes: number;
  /** What deleting actually frees: files no other title uses. */
  freeableBytes: number;
  /** Unfinished downloads that deleting would also cancel. */
  pendingCount: number;
  episodeIds: number[];
}

export interface StorageFile {
  name: string;
  bytes: number;
  episodeIds: number[];
  titles: StorageTitleRef[];
}

export interface StorageSummary {
  totalBytes: number;
  fileCount: number;
  split: { series: number; movie: number };
  titles: StorageTitle[];
  files: StorageFile[];
}

export type ImportMode = 'merge' | 'replace';

export interface ImportSummary {
  mode: ImportMode;
  incoming: { titles: number; episodes: number; withProgress: number };
  addedTitles: number;
  updatedTitles: number;
  addedEpisodes: number;
  progressUpdated: number;
  removedTitles: number;
  relinkedVideos: number;
  unlinked: { files: number; bytes: number };
  /** Set once an import has run; null for a preview. */
  backup: string | null;
}

export interface Settings {
  mediaDir: string;
  maxHeight: 360 | 480 | 720 | 1080 | 1440 | 2160;
  concurrency: number;
  autoDownload: boolean;
  cookiesFromBrowser: string;
  network: 'local' | 'home';
}

export interface Me {
  /** True on the PC running youtube-flix; other devices get the household view. */
  local: boolean;
  authenticated: boolean;
  network: 'local' | 'home';
  hasPassword: boolean;
}

export interface NetworkInfo {
  addresses: { label: string; url: string }[];
}

export interface ToolInfo {
  ok: boolean;
  path: string;
  version: string | null;
}

export interface SystemInfo {
  tools: { ytDlp: ToolInfo; ffmpeg: ToolInfo };
  library: { files: number; bytes: number };
}
