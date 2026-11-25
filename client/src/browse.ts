// Shared browsing rules: hero picks, recommendations, channel links and the grid/carousel choice.
// Genres are the titles' tags; the UI calls them "Genres".
import { useState } from 'react';
import type { TitleSummary, TitleType } from './types';

export const HERO_SIZE = 4;
const PER_TYPE = 2;

export const genresOf = (t: Pick<TitleSummary, 'tags'>): string[] => t.tags;

export const channelPath = (channel: string) => `/channel/${encodeURIComponent(channel)}`;

export const byName = (a: TitleSummary, b: TitleSummary) => a.name.localeCompare(b.name);

function shuffle<T>(items: T[], random: () => number): T[] {
  return items
    .map((item) => ({ item, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ item }) => item);
}

/**
 * Up to 4 titles for the hero: anything marked "Feature on home" first, then 2 series and 2 movies
 * at random, then whatever is left if one type runs short. On a page showing one type, all 4 come
 * from that type.
 */
export function pickHeroes(titles: TitleSummary[], random: () => number = Math.random): TitleSummary[] {
  const pool = shuffle(titles, random);
  const featured = pool.filter((t) => t.featured).slice(0, HERO_SIZE);
  const ofType = (type: TitleType, taken: TitleSummary[]) => {
    const missing = Math.max(0, PER_TYPE - taken.filter((t) => t.type === type).length);
    return pool.filter((t) => t.type === type && !taken.includes(t)).slice(0, missing);
  };
  const withSeries = [...featured, ...ofType('series', featured)];
  const withBoth = [...withSeries, ...ofType('movie', withSeries)];
  return [...withBoth, ...pool.filter((t) => !withBoth.includes(t))].slice(0, HERO_SIZE);
}

/**
 * Titles that share a genre or the channel with `title`, best first: each shared genre counts more
 * than the channel. Never the title itself; empty when nothing is in common.
 */
export function recommend(title: Pick<TitleSummary, 'id' | 'tags' | 'channel'>, titles: TitleSummary[], limit = 12): TitleSummary[] {
  const genres = new Set(genresOf(title).map((g) => g.toLowerCase()));
  const score = (t: TitleSummary) =>
    genresOf(t).filter((g) => genres.has(g.toLowerCase())).length * 2 + (title.channel && t.channel === title.channel ? 1 : 0);
  return titles
    .filter((t) => t.id !== title.id)
    .map((t) => ({ t, s: score(t) }))
    .filter(({ s }) => s > 0)
    .sort((a, b) => b.s - a.s || byName(a.t, b.t))
    .slice(0, limit)
    .map(({ t }) => t);
}

export type ViewMode = 'carousel' | 'grid';
const VIEW_KEY = 'ytf.home.view';

/** Carousel or grid for the Home rows, remembered in this browser only. */
export function useViewMode(): [ViewMode, (mode: ViewMode) => void] {
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'carousel';
    } catch {
      return 'carousel';
    }
  });
  const choose = (next: ViewMode) => {
    setMode(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // Blocked storage only means the choice is not remembered.
    }
  };
  return [mode, choose];
}

/** Grid classes shared by grid view, filter results, channel pages and recommendations. */
export const GRID = 'grid grid-cols-2 gap-x-2 gap-y-16 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6';
