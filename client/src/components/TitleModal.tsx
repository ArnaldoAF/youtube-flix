import { Download, Pencil, Play, RefreshCw, Star, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { fallbackToHq, formatBytes, formatDuration, heroImage, progressPercent } from '../format';
import { useCatalog } from '../store';
import type { Episode, TitleDetail } from '../types';
import { DownloadControl } from './DownloadControl';
import { EditTitleForm } from './EditTitleForm';

export function TitleModal({ id }: { id: number }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { version, reload } = useCatalog();
  const { local } = useAuth();
  const [title, setTitle] = useState<TitleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seasonId, setSeasonId] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('t');
    setParams(next);
  };

  useEffect(() => {
    api
      .title(id)
      .then((t) => {
        setTitle(t);
        setSeasonId((current) => current ?? t.seasons[0]?.id ?? null);
      })
      .catch((err: Error) => setError(err.message));
  }, [id, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  });

  const run = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onDelete = () => {
    if (!title) return;
    if (!confirm(`Remove "${title.name}" from the catalog?`)) return;
    const deleteFiles = title.downloadedCount > 0 && confirm('Also delete the downloaded MP4 files from disk?');
    void run('delete', async () => {
      await api.deleteTitle(title.id, !deleteFiles);
      close();
    });
  };

  const season = title?.seasons.find((s) => s.id === seasonId) ?? title?.seasons[0];
  const isSeries = title?.type === 'series';
  const allEpisodes = title?.seasons.flatMap((s) => s.episodes) ?? [];
  const sizeOnDisk = allEpisodes.reduce((sum, e) => sum + (e.hasLocalFile ? (e.fileSize ?? 0) : 0), 0);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black/70 px-2 py-8" onClick={close}>
      <div
        role="dialog"
        aria-modal="true"
        className="relative mx-auto w-full max-w-4xl overflow-hidden rounded-lg bg-flix-panel shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          aria-label="Close"
          onClick={close}
          className="absolute right-3 top-3 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-flix-panel/90 hover:bg-black"
        >
          <X size={20} />
        </button>

        {!title ? (
          <div className="p-16 text-center text-white/60">{error ?? 'Loading…'}</div>
        ) : (
          <>
            <div className="relative aspect-video max-h-[60vh] w-full">
              {title.thumbnail && (
                <img
                  src={heroImage(title.thumbnail) ?? undefined}
                  onLoad={fallbackToHq}
                  onError={fallbackToHq}
                  alt=""
                  className="h-full w-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-flix-panel via-flix-panel/20 to-transparent" />
              <div className="absolute bottom-6 left-6 right-6 md:left-10">
                <h2 className="mb-4 text-3xl font-black drop-shadow-lg md:text-4xl">{title.name}</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={async () => navigate(`/watch/${(await api.playTarget(title.id)).episodeId}`)}
                    className="flex items-center gap-2 rounded bg-white px-6 py-2 font-semibold text-black hover:bg-white/80"
                  >
                    <Play size={20} fill="currentColor" /> Play
                  </button>
                  <IconAction label="Download all" onClick={() => run('download', () => api.download({ titleId: title.id }))}>
                    <Download size={18} />
                  </IconAction>
                  <IconAction label={title.featured ? 'Unfeature' : 'Feature on home'} onClick={() => run('feature', () => api.updateTitle(title.id, { featured: !title.featured }))}>
                    <Star size={18} fill={title.featured ? 'currentColor' : 'none'} />
                  </IconAction>
                  <IconAction label="Edit" onClick={() => setEditing((v) => !v)}>
                    <Pencil size={18} />
                  </IconAction>
                  {title.seasons.some((s) => s.playlistId) && (
                    <IconAction label="Check playlist for new videos" onClick={() => run('refresh', () => api.refresh(title.id))}>
                      <RefreshCw size={18} className={busy === 'refresh' ? 'animate-spin' : ''} />
                    </IconAction>
                  )}
                  {local && (
                    <IconAction label="Remove from catalog" onClick={onDelete}>
                      <Trash2 size={18} />
                    </IconAction>
                  )}
                </div>
              </div>
            </div>

            <div className="px-6 pb-8 md:px-10">
              {error && <p className="mb-4 rounded bg-flix-red/20 px-3 py-2 text-sm text-red-200">{error}</p>}
              {editing ? (
                <EditTitleForm
                  title={title}
                  onDone={async () => {
                    setEditing(false);
                    await reload();
                  }}
                />
              ) : (
                <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
                  <div>
                    <p className="mb-3 text-sm text-white/70">
                      {[
                        isSeries ? `${title.seasonCount} season${title.seasonCount === 1 ? '' : 's'}` : null,
                        formatDuration(title.totalDuration),
                        `${title.downloadedCount}/${title.episodeCount} downloaded`,
                        sizeOnDisk ? formatBytes(sizeOnDisk) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="whitespace-pre-line text-sm leading-relaxed text-white/90 line-clamp-6">
                      {title.description || 'No description.'}
                    </p>
                  </div>
                  <div className="space-y-2 text-sm">
                    {title.channel && <Meta label="Channel" value={title.channel} />}
                    {title.tags.length > 0 && <Meta label="Tags" value={title.tags.join(', ')} />}
                    <a href={title.sourceUrl} target="_blank" rel="noreferrer" className="block text-white/50 hover:text-white">
                      Open on YouTube ↗
                    </a>
                  </div>
                </div>
              )}

              {(isSeries || allEpisodes.length > 1) && season && (
                <div className="mt-8">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h3 className="text-xl font-bold">{isSeries ? 'Episodes' : 'Parts'}</h3>
                    {isSeries && title.seasons.length > 1 && (
                      <select
                        value={season.id}
                        onChange={(e) => setSeasonId(Number(e.target.value))}
                        className="rounded border border-white/30 bg-black px-3 py-1.5 text-sm"
                      >
                        {title.seasons.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name} ({s.episodes.length})
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                  <ol className="divide-y divide-white/10 border-t border-white/10">
                    {season.episodes.map((ep) => (
                      <EpisodeRow key={ep.id} episode={ep} onPlay={() => navigate(`/watch/${ep.id}`)} />
                    ))}
                  </ol>
                </div>
              )}

              {!isSeries && allEpisodes.length === 1 && (
                <div className="mt-6 flex items-center gap-3 text-sm text-white/70">
                  <span>Local copy:</span>
                  <DownloadControl episode={allEpisodes[0]} />
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function IconAction({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      aria-label={label}
      onClick={onClick}
      className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-white/50 bg-black/40 hover:border-white"
    >
      {children}
    </button>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <p>
      <span className="text-white/50">{label}: </span>
      {value}
    </p>
  );
}

function EpisodeRow({ episode, onPlay }: { episode: Episode; onPlay: () => void }) {
  const percent = progressPercent(episode.progress, episode.duration);
  return (
    <li className="group flex cursor-pointer items-center gap-4 rounded px-2 py-4 hover:bg-white/5" onClick={onPlay}>
      <span className="w-6 shrink-0 text-center text-xl text-white/60">{episode.position}</span>
      <div className="relative w-32 shrink-0 overflow-hidden rounded md:w-40">
        <img src={episode.thumbnail ?? undefined} alt="" loading="lazy" className="aspect-video w-full object-cover" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition group-hover:opacity-100">
          <Play size={28} fill="currentColor" />
        </div>
        {percent > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/30">
            <div className="h-full bg-flix-red" style={{ width: `${percent}%` }} />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate font-semibold">{episode.name}</p>
          <span className="shrink-0 text-sm text-white/60">{formatDuration(episode.duration)}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm text-white/60">{episode.description}</p>
      </div>
      <div className="shrink-0" onClick={(e) => e.stopPropagation()}>
        <DownloadControl episode={episode} />
      </div>
    </li>
  );
}
