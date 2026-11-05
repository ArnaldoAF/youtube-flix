import { AlertCircle, CheckCircle2, Download, Loader2, Pause, Play, Trash2, X } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';
import { useLiveDownloads } from '../store';
import type { DownloadStatus, Episode } from '../types';

const iconBtn = 'flex h-8 w-8 items-center justify-center rounded-full border border-white/40 hover:border-white';

/** Live status from SSE wins over the (possibly stale) catalog snapshot. */
export function useEpisodeStatus(episode: Episode): { status: DownloadStatus; percent: number | null; error: string | null } {
  const live = useLiveDownloads()[episode.id];
  return {
    status: live?.status ?? episode.downloadStatus,
    percent: live?.percent ?? null,
    error: live?.error ?? episode.downloadError,
  };
}

export function DownloadControl({ episode }: { episode: Episode }) {
  const { status, percent, error } = useEpisodeStatus(episode);
  const { local } = useAuth();
  const act = (fn: () => Promise<unknown>) => (e: React.MouseEvent) => {
    e.stopPropagation();
    void fn();
  };

  switch (status) {
    case 'done':
      return (
        <div className="flex items-center gap-1">
          <CheckCircle2 size={20} className="text-emerald-400" aria-label="Downloaded" />
          {local && (
            <button
              className="rounded p-1 text-white/50 hover:text-white"
              title="Delete local file"
              onClick={act(() => api.deleteFile(episode.id))}
            >
              <Trash2 size={16} />
            </button>
          )}
        </div>
      );
    case 'downloading':
      return (
        <div className="flex items-center gap-1.5">
          <span className="w-10 text-right text-xs tabular-nums text-white/80">
            {percent == null ? <Loader2 size={14} className="ml-auto animate-spin" /> : `${Math.floor(percent)}%`}
          </span>
          <button className={iconBtn} title="Pause" onClick={act(() => api.downloadAction(episode.id, 'pause'))}>
            <Pause size={14} />
          </button>
          <button className={iconBtn} title="Cancel" onClick={act(() => api.downloadAction(episode.id, 'cancel'))}>
            <X size={14} />
          </button>
        </div>
      );
    case 'queued':
      return (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-white/60">Queued</span>
          <button className={iconBtn} title="Cancel" onClick={act(() => api.downloadAction(episode.id, 'cancel'))}>
            <X size={14} />
          </button>
        </div>
      );
    case 'paused':
    case 'error':
      return (
        <div className="flex items-center gap-1.5">
          {status === 'error' ? (
            <AlertCircle size={18} className="text-flix-red" aria-label={error ?? 'Download failed'}>
              <title>{error ?? 'Download failed'}</title>
            </AlertCircle>
          ) : (
            <span className="text-xs text-white/60">Paused</span>
          )}
          <button
            className={iconBtn}
            title={status === 'error' ? 'Retry' : 'Resume'}
            onClick={act(() => api.downloadAction(episode.id, 'resume'))}
          >
            <Play size={14} />
          </button>
          <button className={iconBtn} title="Cancel" onClick={act(() => api.downloadAction(episode.id, 'cancel'))}>
            <X size={14} />
          </button>
        </div>
      );
    default:
      return (
        <button className={iconBtn} title="Download" onClick={act(() => api.download({ episodeIds: [episode.id] }))}>
          <Download size={14} />
        </button>
      );
  }
}
