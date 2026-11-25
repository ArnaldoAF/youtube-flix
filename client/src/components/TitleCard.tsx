import { CheckCircle2, ChevronDown, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { formatDuration } from '../format';
import { ChannelLink } from './ChannelLink';
import type { ContinueItem, TitleSummary } from '../types';

function useOpenTitle() {
  const [params, setParams] = useSearchParams();
  return (id: number) => {
    const next = new URLSearchParams(params);
    next.set('t', String(id));
    setParams(next);
  };
}

function CardShell({
  image,
  name,
  meta,
  progress,
  badge,
  label,
  onPlay,
  onOpen,
  wide = false,
}: {
  image: string | null;
  name: string;
  meta: ReactNode;
  progress?: number;
  badge?: ReactNode;
  /** Small top-left tag, like "1/2" for a movie in a collection. */
  label?: string;
  onPlay: () => void;
  onOpen: () => void;
  wide?: boolean;
}) {
  return (
    <div
      className={`group/card relative shrink-0 cursor-pointer transition-transform duration-300 hover:z-10 hover:scale-110 ${
        wide ? 'w-full' : 'w-[44vw] sm:w-[30vw] md:w-[23vw] lg:w-[18vw] xl:w-[15.5vw]'
      }`}
      onClick={onOpen}
    >
      <div className="relative aspect-video overflow-hidden rounded bg-flix-panel">
        {image ? (
          <img src={image} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-sm text-white/60">{name}</div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-6">
          <p className="line-clamp-1 text-sm font-semibold drop-shadow">{name}</p>
        </div>
        {badge && <div className="absolute right-1.5 top-1.5">{badge}</div>}
        {label && (
          <div className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-white/90">{label}</div>
        )}
        {progress !== undefined && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/30">
            <div className="h-full bg-flix-red" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-full -mt-1 rounded-b bg-flix-panel p-2 opacity-0 shadow-xl shadow-black/60 transition-opacity group-hover/card:pointer-events-auto group-hover/card:opacity-100">
        <div className="flex items-center gap-2">
          <button
            aria-label="Play"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-white text-black hover:bg-white/80"
          >
            <Play size={14} fill="currentColor" />
          </button>
          <button
            aria-label="More info"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-full border border-white/50 hover:border-white"
          >
            <ChevronDown size={16} />
          </button>
        </div>
        <p className="mt-1.5 text-[11px] text-white/70">{meta}</p>
      </div>
    </div>
  );
}

/** Seasons and episodes, or length and parts: everything about a title except its channel. */
export function titleFacts(t: TitleSummary): string {
  const parts =
    t.type === 'series'
      ? [`${t.seasonCount} season${t.seasonCount === 1 ? '' : 's'}`, `${t.episodeCount} ep.`]
      : [formatDuration(t.totalDuration), t.episodeCount > 1 ? `${t.episodeCount} parts` : null];
  return parts.filter(Boolean).join(' · ');
}

export function titleMeta(t: TitleSummary): string {
  return [titleFacts(t), t.channel].filter(Boolean).join(' · ');
}

/** The same line, with the channel as a link to its page. */
export function TitleMetaLine({ title }: { title: TitleSummary }) {
  const facts = titleFacts(title);
  return (
    <>
      {facts}
      {facts && title.channel ? ' · ' : null}
      {title.channel && <ChannelLink channel={title.channel} />}
    </>
  );
}

export function TitleCard({ title, wide }: { title: TitleSummary; wide?: boolean }) {
  const open = useOpenTitle();
  const navigate = useNavigate();
  const downloaded = title.episodeCount > 0 && title.downloadedCount === title.episodeCount;
  return (
    <CardShell
      wide={wide}
      image={title.thumbnail}
      name={title.name}
      meta={<TitleMetaLine title={title} />}
      badge={downloaded ? <CheckCircle2 size={18} className="text-emerald-400 drop-shadow" aria-label="Downloaded" /> : null}
      label={title.collection ? `${title.collection.position}/${title.collection.size}` : undefined}
      onOpen={() => open(title.id)}
      onPlay={async () => navigate(`/watch/${(await api.playTarget(title.id)).episodeId}`)}
    />
  );
}

export function ContinueCard({ item, wide }: { item: ContinueItem; wide?: boolean }) {
  const open = useOpenTitle();
  const navigate = useNavigate();
  const { episode, title } = item;
  const label = title.type === 'series' ? `S${item.seasonNumber}:E${episode.position} ${episode.name}` : title.name;
  const duration = episode.progress?.duration ?? episode.duration;
  const progress = episode.progress && duration ? (episode.progress.seconds / duration) * 100 : 0;
  return (
    <CardShell
      wide={wide}
      image={episode.thumbnail ?? title.thumbnail}
      name={title.type === 'series' ? title.name : label}
      meta={title.type === 'series' ? label : formatDuration(duration)}
      progress={progress}
      onOpen={() => open(title.id)}
      onPlay={() => navigate(`/watch/${episode.id}`)}
    />
  );
}
