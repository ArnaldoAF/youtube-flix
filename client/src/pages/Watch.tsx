import { HardDrive } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { NetflixPlayer } from '../player/NetflixPlayer';
import { useCatalog } from '../store';
import type { EpisodeContext } from '../types';

const SAVE_EVERY_MS = 10_000;

/** Resume only if we're past the intro and not at the credits. */
function resumeAt(ctx: EpisodeContext): number {
  const p = ctx.episode.progress;
  const duration = p?.duration ?? ctx.episode.duration;
  if (!p || p.seconds < 30 || (duration && p.seconds > duration * 0.95)) return 0;
  return Math.floor(p.seconds);
}

export function Watch() {
  const { episodeId } = useParams();
  const navigate = useNavigate();
  const { reload } = useCatalog();
  const [ctx, setCtx] = useState<EpisodeContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lastSaved = useRef(0);
  const latest = useRef<{ seconds: number; duration: number | null }>({ seconds: 0, duration: null });

  useEffect(() => {
    setCtx(null);
    api
      .episode(Number(episodeId))
      .then(setCtx)
      .catch((err: Error) => setError(err.message));
  }, [episodeId]);

  // Flush the last position when leaving the episode or closing the tab, then refresh the catalog
  // so "Continue watching" shows the position that was just saved.
  useEffect(() => {
    if (!ctx) return;
    const id = ctx.episode.id;
    latest.current = { seconds: 0, duration: null };
    lastSaved.current = 0;
    const flush = () => {
      const { seconds, duration } = latest.current;
      return seconds > 0 ? api.saveProgress(id, seconds, duration).catch(() => undefined) : Promise.resolve();
    };
    const onUnload = () => void flush();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      void flush().then(reload);
    };
  }, [ctx, reload]);

  const save = useCallback(
    (seconds: number, duration: number | null, force = false) => {
      if (!ctx || seconds <= 0) return;
      latest.current = { seconds, duration };
      const now = Date.now();
      if (!force && now - lastSaved.current < SAVE_EVERY_MS) return;
      lastSaved.current = now;
      void api.saveProgress(ctx.episode.id, seconds, duration).catch(() => undefined);
    },
    [ctx],
  );

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 bg-black">
        <p className="text-red-300">{error}</p>
        <button onClick={() => navigate(-1)} className="rounded bg-white/15 px-4 py-2">
          Go back
        </button>
      </div>
    );
  }
  if (!ctx) return <div className="h-screen bg-black" />;

  const { episode, title, season, nextEpisodeId, nextTitle } = ctx;
  const isSeries = title.type === 'series';

  return (
    <NetflixPlayer
      // A new episode, or switching from local file to YouTube, mounts a fresh player.
      key={`${episode.id}-${episode.hasLocalFile}`}
      source={
        episode.hasLocalFile
          ? { kind: 'local', src: api.streamUrl(episode.id) }
          : { kind: 'youtube', videoId: episode.youtubeId }
      }
      start={resumeAt(ctx)}
      title={title.name}
      subtitle={isSeries ? `S${season.number}:E${episode.position}  ${episode.name}` : undefined}
      badge={
        episode.hasLocalFile ? (
          <span className="flex items-center gap-1.5 rounded bg-white/10 px-2.5 py-1 text-sm text-white/70">
            <HardDrive size={14} /> Local file
          </span>
        ) : null
      }
      next={nextEpisodeId ? () => navigate(`/watch/${nextEpisodeId}`, { replace: true }) : null}
      nextLabel={nextTitle ? 'Next movie' : 'Next episode'}
      onBack={() => navigate(`/?t=${title.id}`)}
      onProgress={save}
      onEnded={(duration) => duration && save(duration, duration, true)}
      // File missing on disk: the server has cleared it, so reloading switches to the YouTube player.
      onMissing={() => api.episode(episode.id).then(setCtx).catch((err: Error) => setError(err.message))}
    />
  );
}
