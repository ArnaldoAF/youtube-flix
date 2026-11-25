import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { byName, collectionGroups, genresOf, GRID, pickHeroes, useViewMode, type ViewMode } from '../browse';
import { SuggestionPrompt, useSuggestions } from '../components/CollectionPanels';
import { BrowseToolbar, ViewToggle, type FilterOptions } from '../components/BrowseToolbar';
import { HeroCarousel } from '../components/Hero';
import { Row } from '../components/Row';
import { ContinueCard, TitleCard } from '../components/TitleCard';
import { useCatalog } from '../store';
import type { TitleSummary } from '../types';

const unique = (values: (string | null)[]) =>
  [...new Set(values.filter((v): v is string => Boolean(v)))].sort((a, b) => a.localeCompare(b));

export function Home({ filter }: { filter?: 'movie' | 'series' }) {
  const { titles: all, continueItems, loading, error } = useCatalog();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useViewMode();
  const titles = useMemo(() => (filter ? all.filter((t) => t.type === filter) : all), [all, filter]);

  // Drawn again only when the set of titles changes, so a finished download doesn't reshuffle the hero.
  const idKey = titles.map((t) => t.id).sort((a, b) => a - b).join(',');
  const heroIds = useMemo(() => pickHeroes(titles).map((t) => t.id), [idKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const heroes = heroIds.map((id) => titles.find((t) => t.id === id)).filter((t): t is TitleSummary => Boolean(t));

  if (loading) return <div className="pt-40 text-center text-white/50">Loading…</div>;
  if (error) return <div className="pt-40 text-center text-red-300">Could not reach the server: {error}</div>;
  if (!titles.length) return <EmptyState filter={filter} />;

  const genre = params.get('genre') ?? '';
  const channel = params.get('channel') ?? '';
  const filters: FilterOptions | undefined = filter
    ? {
        genre,
        channel,
        // A value from the address that no title has (an old link) stays listed, so the select never
        // claims "All" while a filter is still applied.
        genres: unique([...titles.flatMap(genresOf), genre]),
        channels: unique([...titles.map((t) => t.channel), channel]),
        onChange: (change) => {
          const next = new URLSearchParams(params);
          Object.entries(change).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
          setParams(next, { replace: true });
        },
      }
    : undefined;

  if (filters && (genre || channel)) {
    return (
      <div className="relative min-h-screen">
        <BrowseToolbar filters={filters} />
        <FilteredGrid titles={titles} genre={genre} channel={channel} kind={filter === 'series' ? 'series' : 'movies'} onClear={() => filters.onChange({ genre: '', channel: '' })} />
      </div>
    );
  }

  return (
    <div className="relative pb-16">
      {filters && <BrowseToolbar filters={filters} />}
      <HeroCarousel titles={heroes} />
      {/* Below the banner, never on it: the rows start after this line at every window width. */}
      <div className="mt-8 flex justify-end px-4 md:px-12">
        <ViewToggle view={view} onView={setView} />
      </div>
      {filter === 'movie' && <SuggestedCollections />}
      <HomeRows titles={titles} continueItems={continueItems.filter((c) => !filter || c.title.type === filter)} filter={filter} view={view} />
    </div>
  );
}

function HomeRows({
  titles,
  continueItems,
  filter,
  view,
}: {
  titles: TitleSummary[];
  continueItems: ReturnType<typeof useCatalog>['continueItems'];
  filter?: 'movie' | 'series';
  view: ViewMode;
}) {
  const grid = view === 'grid';
  const card = (t: TitleSummary) => <TitleCard key={t.id} title={t} wide={grid} />;
  const genres = unique(titles.flatMap(genresOf));
  const downloaded = titles.filter((t) => t.downloadedCount > 0 && t.downloadedCount === t.episodeCount);
  const ofType = (type: 'movie' | 'series') => titles.filter((t) => t.type === type).sort(byName);

  return (
    <div className="relative z-10">
      {continueItems.length > 0 && (
        <Row title="Continue watching" layout={view}>
          {continueItems.map((c) => (
            <ContinueCard key={c.title.id} item={c} wide={grid} />
          ))}
        </Row>
      )}
      <Row title="Recently added" layout={view}>
        {titles.slice(0, 20).map(card)}
      </Row>
      {!filter && ofType('series').length > 0 && (
        <Row title="Series" layout={view}>
          {ofType('series').map(card)}
        </Row>
      )}
      {!filter && ofType('movie').length > 0 && (
        <Row title="Movies" layout={view}>
          {ofType('movie').map(card)}
        </Row>
      )}
      {collectionGroups(titles).map((c) => (
        <Row key={`collection-${c.id}`} title={c.name} layout={view}>
          {c.movies.map(card)}
        </Row>
      ))}
      {genres.map((g) => (
        <Row key={g} title={g} layout={view}>
          {titles.filter((t) => genresOf(t).includes(g)).map(card)}
        </Row>
      ))}
      {downloaded.length > 0 && (
        <Row title="Available offline" layout={view}>
          {downloaded.map(card)}
        </Row>
      )}
    </div>
  );
}

function FilteredGrid({
  titles,
  genre,
  channel,
  kind,
  onClear,
}: {
  titles: TitleSummary[];
  genre: string;
  channel: string;
  kind: 'series' | 'movies';
  onClear: () => void;
}) {
  const results = titles.filter((t) => (!genre || genresOf(t).includes(genre)) && (!channel || t.channel === channel)).sort(byName);
  const label = [genre && `genre “${genre}”`, channel && `channel “${channel}”`].filter(Boolean).join(' and ');
  return (
    <div className="px-4 pb-16 pt-32 md:px-12">
      <h1 className="mb-6 text-lg text-white/60">
        {results.length} {kind === 'movies' && results.length === 1 ? 'movie' : kind} with {label}
        <button onClick={onClear} className="ml-3 text-sm text-white/80 underline-offset-2 hover:text-white hover:underline">
          Clear filters
        </button>
      </h1>
      {results.length ? (
        <div className={GRID}>
          {results.map((t) => (
            <TitleCard key={t.id} title={t} wide />
          ))}
        </div>
      ) : (
        <p className="text-white/60">
          {genre && channel ? 'Nothing matches both filters.' : 'Nothing matches this filter.'} Try another genre or channel.
        </p>
      )}
    </div>
  );
}

/** On the Movies page: collections the app detected and the user has not dismissed. */
function SuggestedCollections() {
  const [suggestions, refresh] = useSuggestions();
  if (!suggestions.length) return null;
  return (
    <section className="mx-4 mt-6 md:mx-12">
      <h2 className="mb-2 text-lg font-semibold text-white/90">Suggested collections</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {suggestions.map((s) => (
          <SuggestionPrompt key={s.titleIds.join(',')} suggestion={s} onDone={refresh} />
        ))}
      </div>
    </section>
  );
}

function EmptyState({ filter }: { filter?: 'movie' | 'series' }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <h1 className="text-3xl font-black md:text-4xl">
        {filter ? `No ${filter === 'movie' ? 'movies' : 'series'} yet` : 'Your catalog is empty'}
      </h1>
      <p className="mt-3 max-w-md text-white/70">
        Paste a YouTube video or playlist link and it becomes a movie or series here, with thumbnail and duration.
      </p>
      <Link to="/add" className="mt-6 rounded bg-flix-red px-6 py-3 font-semibold hover:bg-flix-red-dark">
        Add your first title
      </Link>
    </div>
  );
}
