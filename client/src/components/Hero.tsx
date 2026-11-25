import { ChevronLeft, ChevronRight, Info, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { fallbackToHq, heroImage } from '../format';
import type { TitleSummary } from '../types';
import { TitleMetaLine } from './TitleCard';

const SLIDE_MS = 10_000;

/**
 * Shows the next title every 10 s, always: nothing pauses it. The arrows go back and forward and
 * restart the 10 s count, so a slide picked by hand stays up for the full time.
 */
export function HeroCarousel({ titles }: { titles: TitleSummary[] }) {
  const [index, setIndex] = useState(0);
  // Bumped by the arrows, so the count starts again from the chosen slide.
  const [restart, setRestart] = useState(0);
  const count = titles.length;
  const current = count ? index % count : 0;

  useEffect(() => {
    if (count < 2) return;
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % count), SLIDE_MS);
    return () => window.clearInterval(timer);
  }, [count, restart]);

  if (!count) return null;

  const show = (i: number) => {
    setIndex(((i % count) + count) % count);
    setRestart((r) => r + 1);
  };
  const arrow = 'absolute top-1/2 z-20 flex -translate-y-1/2 rounded-full bg-black/40 p-1 text-white/80 backdrop-blur hover:bg-black/70 hover:text-white sm:p-2';

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured titles"
      className="relative h-[56vw] max-h-[85vh] min-h-[420px] w-full overflow-hidden"
    >
      {/* All backdrops stay loaded and cross-fade; only the current one is visible. */}
      {titles.map((t, i) =>
        t.thumbnail ? (
          <img
            key={t.id}
            src={heroImage(t.thumbnail) ?? undefined}
            onLoad={fallbackToHq}
            onError={fallbackToHq}
            alt=""
            className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ${i === current ? 'opacity-100' : 'opacity-0'}`}
          />
        ) : null,
      )}
      <div className="hero-fade absolute inset-0" />

      <HeroSlide title={titles[current]} position={`${current + 1} of ${count}`} />

      {count > 1 && (
        <>
          <button type="button" aria-label="Previous title" onClick={() => show(current - 1)} className={`${arrow} left-2 md:left-4`}>
            <ChevronLeft size={32} />
          </button>
          <button type="button" aria-label="Next title" onClick={() => show(current + 1)} className={`${arrow} right-2 md:right-4`}>
            <ChevronRight size={32} />
          </button>
          {/* Indicators only: they show the current slide but are not clickable. */}
          <div aria-hidden className="pointer-events-none absolute bottom-[14%] left-4 z-20 flex gap-2 md:left-12">
            {titles.map((t, i) => (
              <span key={t.id} className={`h-1.5 rounded-full transition-all ${i === current ? 'w-6 bg-white' : 'w-3 bg-white/40'}`} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function HeroSlide({ title, position }: { title: TitleSummary; position: string }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const openInfo = () => {
    const next = new URLSearchParams(params);
    next.set('t', String(title.id));
    setParams(next);
  };

  return (
    <div role="group" aria-roledescription="slide" aria-label={position} className="absolute bottom-[22%] left-4 right-4 z-10 max-w-xl md:left-16">
      <p className="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-flix-red">{title.type === 'series' ? 'Series' : 'Movie'}</p>
      <h1 className="line-clamp-2 text-3xl font-black leading-tight drop-shadow-lg md:text-5xl lg:text-6xl">{title.name}</h1>
      <p className="mt-2 text-sm text-white/80">
        <TitleMetaLine title={title} />
      </p>
      <div className="mt-5 flex gap-3">
        <button
          onClick={async () => navigate(`/watch/${(await api.playTarget(title.id)).episodeId}`)}
          className="flex items-center gap-2 rounded bg-white px-5 py-2 font-semibold text-black hover:bg-white/80 md:px-7 md:text-lg"
        >
          <Play size={22} fill="currentColor" /> Play
        </button>
        <button
          onClick={openInfo}
          className="flex items-center gap-2 rounded bg-white/25 px-5 py-2 font-semibold backdrop-blur hover:bg-white/15 md:px-7 md:text-lg"
        >
          <Info size={22} /> More info
        </button>
      </div>
    </div>
  );
}
