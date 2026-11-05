import { Info, Play } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { fallbackToHq, heroImage } from '../format';
import type { TitleSummary } from '../types';
import { titleMeta } from './TitleCard';

export function Hero({ title }: { title: TitleSummary }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const openInfo = () => {
    const next = new URLSearchParams(params);
    next.set('t', String(title.id));
    setParams(next);
  };

  return (
    <section className="relative h-[56vw] max-h-[85vh] min-h-[420px] w-full overflow-hidden">
      {title.thumbnail && (
        <img
          src={heroImage(title.thumbnail) ?? undefined}
          onLoad={fallbackToHq}
          onError={fallbackToHq}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="hero-fade absolute inset-0" />
      <div className="absolute bottom-[22%] left-4 max-w-xl md:left-12">
        <p className="mb-2 text-xs font-bold uppercase tracking-[0.3em] text-flix-red">
          {title.type === 'series' ? 'Series' : 'Movie'}
        </p>
        <h1 className="text-3xl font-black leading-tight drop-shadow-lg md:text-5xl lg:text-6xl">{title.name}</h1>
        <p className="mt-2 text-sm text-white/80">{titleMeta(title)}</p>
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
    </section>
  );
}
