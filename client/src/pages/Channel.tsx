import { Film, Tv, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { byName, GRID } from '../browse';
import { TitleCard } from '../components/TitleCard';
import { useCatalog } from '../store';
import type { TitleSummary } from '../types';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Everything in the catalog from one YouTube channel, split into series and movies. */
export function Channel() {
  const { name = '' } = useParams();
  const { titles, loading, error } = useCatalog();
  if (loading) return <div className="pt-40 text-center text-white/50">Loading…</div>;
  if (error) return <div className="pt-40 text-center text-red-300">Could not reach the server: {error}</div>;

  const mine = titles.filter((t) => t.channel === name).sort(byName);
  const series = mine.filter((t) => t.type === 'series');
  const movies = mine.filter((t) => t.type === 'movie');

  if (!mine.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-black">Nothing from “{name}”</h1>
        <p className="mt-2 text-white/60">No title in your catalog comes from this channel.</p>
        <Link to="/" className="mt-6 rounded bg-white/15 px-5 py-2 hover:bg-white/25">
          Back to Home
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 pb-16 pt-24 md:px-12">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em] text-flix-red">
        <UserRound size={14} aria-hidden /> Channel
      </p>
      <h1 className="mt-1 text-3xl font-black md:text-4xl">{name}</h1>
      <p className="mt-2 text-sm text-white/60">
        {[series.length ? plural(series.length, 'series', 'series') : null, movies.length ? plural(movies.length, 'movie', 'movies') : null]
          .filter(Boolean)
          .join(' · ')}
      </p>
      <Section title="Series" icon={<Tv size={20} aria-hidden />} titles={series} />
      <Section title="Movies" icon={<Film size={20} aria-hidden />} titles={movies} />
    </div>
  );
}

function Section({ title, icon, titles }: { title: string; icon: ReactNode; titles: TitleSummary[] }) {
  if (!titles.length) return null;
  return (
    <section className="mt-10">
      <h2 className="mb-4 flex items-center gap-2 text-xl font-semibold">
        {icon}
        {title} <span className="text-white/40">({titles.length})</span>
      </h2>
      <div className={GRID}>
        {titles.map((t) => (
          <TitleCard key={t.id} title={t} wide />
        ))}
      </div>
    </section>
  );
}
