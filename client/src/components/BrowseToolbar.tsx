import { GalleryHorizontal, LayoutGrid } from 'lucide-react';
import type { ViewMode } from '../browse';

const select = 'max-w-[44vw] rounded border border-white/30 bg-black/70 px-2 py-1.5 text-sm backdrop-blur sm:max-w-[14rem]';

export interface FilterOptions {
  genre: string;
  channel: string;
  genres: string[];
  channels: string[];
  onChange: (next: { genre?: string; channel?: string }) => void;
}

/** Top-right genre and channel filters on the Series and Movies pages. */
export function BrowseToolbar({ filters }: { filters: FilterOptions }) {
  return (
    <div className="absolute right-4 top-20 z-30 flex flex-wrap items-center justify-end gap-2 md:right-12">
      <label className="sr-only" htmlFor="filter-genre">
        Genre
      </label>
      <select id="filter-genre" value={filters.genre} onChange={(e) => filters.onChange({ genre: e.target.value })} className={select}>
        <option value="">All genres</option>
        {filters.genres.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="filter-channel">
        Channel
      </label>
      <select id="filter-channel" value={filters.channel} onChange={(e) => filters.onChange({ channel: e.target.value })} className={select}>
        <option value="">All channels</option>
        {filters.channels.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Switch between carousel rows and a grid, shown under the banner. */
export function ViewToggle({ view, onView }: { view: ViewMode; onView: (v: ViewMode) => void }) {
  return (
    <div role="group" aria-label="Layout" className="flex overflow-hidden rounded border border-white/30">
      {(
        [
          ['carousel', 'Carousel rows', GalleryHorizontal],
          ['grid', 'Grid', LayoutGrid],
        ] as const
      ).map(([mode, label, Icon]) => (
        <button
          key={mode}
          type="button"
          aria-label={label}
          title={label}
          aria-pressed={view === mode}
          onClick={() => onView(mode)}
          className={`p-1.5 ${view === mode ? 'bg-white text-black' : 'text-white/70 hover:text-white'}`}
        >
          <Icon size={18} aria-hidden />
        </button>
      ))}
    </div>
  );
}
