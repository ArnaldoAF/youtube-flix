export const PROGRESS_PREFIX = 'YTF';

/** Passed to yt-dlp --progress-template so every progress tick is one machine-readable line. */
export const PROGRESS_TEMPLATE =
  `download:${PROGRESS_PREFIX} %(progress.downloaded_bytes)s %(progress.total_bytes)s ` +
  `%(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s`;

export interface ProgressTick {
  downloaded: number;
  total: number | null;
  percent: number | null;
  speed: number | null;
  eta: number | null;
}

const toNum = (s: string | undefined): number | null => {
  if (!s || s === 'NA' || s === 'None') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

export function parseProgressLine(line: string): ProgressTick | null {
  const parts = line.trim().split(/\s+/);
  if (parts[0] !== PROGRESS_PREFIX) return null;
  const downloaded = toNum(parts[1]);
  if (downloaded === null) return null;
  const total = toNum(parts[2]) ?? toNum(parts[3]);
  return {
    downloaded,
    total,
    percent: total ? Math.min(100, (downloaded / total) * 100) : null,
    speed: toNum(parts[4]),
    eta: toNum(parts[5]),
  };
}

/** "[download] Destination: x.f137.mp4" starts a stream; video and audio are separate streams. */
export const isNewStreamLine = (line: string) => line.startsWith('[download] Destination:');
export const isMergeLine = (line: string) => line.startsWith('[Merger]') || line.startsWith('[VideoRemuxer]');

/**
 * H.264 first: it plays in every browser and TV. YouTube only serves H.264 up to 1080p,
 * so higher limits fall through to VP9/AV1 inside MP4.
 */
export function formatFor(maxHeight: number): string {
  const h = `[height<=${maxHeight}]`;
  return [
    `bv*${h}[vcodec^=avc1]+ba[ext=m4a]`,
    `bv*${h}[ext=mp4]+ba[ext=m4a]`,
    `b${h}[ext=mp4]`,
    `bv*${h}+ba`,
    `b${h}`,
    // Last resort: ignore the height limit rather than fail when only some formats are offered.
    'bv*+ba',
    'b',
  ].join('/');
}
