import type { SyntheticEvent } from 'react';
import type { Progress } from './types';

/** 5400 → "1h 30m", 754 → "12m" (rows/cards). */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (h === 0) return `${Math.max(m, 1)}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

/** 754 → "12:34" (player/ETA). */
export function formatClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '--:--';
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, '0');
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (!bytes) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i >= 3 ? 1 : 0)} ${units[i]}`;
}

export function progressPercent(p: Progress | null, fallbackDuration: number | null): number {
  const duration = p?.duration ?? fallbackDuration;
  if (!p || !duration) return 0;
  return Math.min(100, (p.seconds / duration) * 100);
}

/** YouTube's maxres thumbnails look best on the hero; not every video has one. */
export function heroImage(thumbnail: string | null): string | null {
  return thumbnail?.replace(/\/(hq|mq|sd)default\.jpg.*$/, '/maxresdefault.jpg') ?? null;
}

const YT_THUMB = /^https:\/\/i\.ytimg\.com\/vi(?:_webp)?\/([\w-]{11})\//;

/**
 * Use on both onLoad and onError. A missing maxres thumbnail comes back as HTTP 404 *with* a
 * 120x90 grey placeholder image, which browsers render without firing onError, so the size is checked too.
 */
export function fallbackToHq(e: SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  const id = YT_THUMB.exec(img.src)?.[1];
  const missing = e.type === 'error' || img.naturalWidth <= 120;
  if (id && missing && !img.src.includes('/hqdefault.')) img.src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}
