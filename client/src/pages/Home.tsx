import { Link } from 'react-router-dom';
import { Hero } from '../components/Hero';
import { Row } from '../components/Row';
import { ContinueCard, TitleCard } from '../components/TitleCard';
import { useCatalog } from '../store';
import type { TitleSummary } from '../types';

/** Featured titles win; otherwise pick one per day so the hero doesn't change on every render. */
function pickHero(titles: TitleSummary[]): TitleSummary | null {
  const pool = titles.filter((t) => t.featured).length ? titles.filter((t) => t.featured) : titles;
  if (!pool.length) return null;
  const day = Math.floor(Date.now() / 86_400_000);
  return pool[day % pool.length];
}

export function Home({ filter }: { filter?: 'movie' | 'series' }) {
  const { titles: all, continueItems, loading, error } = useCatalog();
  const titles = filter ? all.filter((t) => t.type === filter) : all;
  const hero = pickHero(titles);

  if (loading) return <div className="pt-40 text-center text-white/50">Loading…</div>;
  if (error) return <div className="pt-40 text-center text-red-300">Could not reach the server: {error}</div>;
  if (!hero) return <EmptyState filter={filter} />;

  const tags = [...new Set(titles.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b));
  const continueRow = continueItems.filter((c) => !filter || c.title.type === filter);
  const downloaded = titles.filter((t) => t.downloadedCount > 0 && t.downloadedCount === t.episodeCount);

  return (
    <div className="pb-16">
      <Hero title={hero} />
      <div className="relative z-10 -mt-[8vw]">
        {continueRow.length > 0 && (
          <Row title="Continue watching">
            {continueRow.map((c) => (
              <ContinueCard key={c.title.id} item={c} />
            ))}
          </Row>
        )}
        <Row title="Recently added">
          {titles.slice(0, 20).map((t) => (
            <TitleCard key={t.id} title={t} />
          ))}
        </Row>
        {!filter && <TypeRow titles={titles} type="series" label="Series" />}
        {!filter && <TypeRow titles={titles} type="movie" label="Movies" />}
        {tags.map((tag) => (
          <Row key={tag} title={tag}>
            {titles
              .filter((t) => t.tags.includes(tag))
              .map((t) => (
                <TitleCard key={t.id} title={t} />
              ))}
          </Row>
        ))}
        {downloaded.length > 0 && (
          <Row title="Available offline">
            {downloaded.map((t) => (
              <TitleCard key={t.id} title={t} />
            ))}
          </Row>
        )}
      </div>
    </div>
  );
}

function TypeRow({ titles, type, label }: { titles: TitleSummary[]; type: 'movie' | 'series'; label: string }) {
  const items = titles.filter((t) => t.type === type).sort((a, b) => a.name.localeCompare(b.name));
  if (!items.length) return null;
  return (
    <Row title={label}>
      {items.map((t) => (
        <TitleCard key={t.id} title={t} />
      ))}
    </Row>
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
