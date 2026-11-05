import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { DownloadControl } from '../components/DownloadControl';
import { formatBytes, formatClock, formatDuration } from '../format';
import { useCatalog, useLiveDownloads } from '../store';
import type { DownloadItem, Episode } from '../types';

const GROUPS: { label: string; statuses: string[] }[] = [
  { label: 'In progress', statuses: ['downloading', 'queued', 'paused'] },
  { label: 'Failed', statuses: ['error'] },
  { label: 'Downloaded', statuses: ['done'] },
];

/** DownloadControl works on episodes; adapt a download row to the fields it reads. */
const asEpisode = (d: DownloadItem): Episode => ({
  id: d.episodeId,
  seasonId: 0,
  youtubeId: '',
  name: d.episodeName,
  description: '',
  duration: d.duration,
  thumbnail: d.thumbnail,
  position: 0,
  uploadDate: null,
  downloadStatus: d.status,
  downloadError: d.error,
  fileSize: d.fileSize,
  hasLocalFile: d.status === 'done',
  progress: null,
});

export function Downloads() {
  const [items, setItems] = useState<DownloadItem[]>([]);
  const live = useLiveDownloads();
  const { version } = useCatalog();

  useEffect(() => {
    api
      .downloads()
      .then((d) => setItems(d.items))
      .catch(() => undefined);
  }, [version]);

  const statusOf = (d: DownloadItem) => live[d.episodeId]?.status ?? d.status;
  const visible = items.filter((d) => statusOf(d) !== 'none');

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-24">
      <h1 className="text-3xl font-black">Downloads</h1>
      {visible.length === 0 && (
        <p className="mt-6 text-white/60">Nothing downloaded yet. Downloads start automatically when you add a title.</p>
      )}
      {GROUPS.map(({ label, statuses }) => {
        const group = visible.filter((d) => statuses.includes(statusOf(d)));
        if (!group.length) return null;
        return (
          <section key={label} className="mt-8">
            <h2 className="mb-2 text-lg font-semibold text-white/80">
              {label} <span className="text-white/40">({group.length})</span>
            </h2>
            <ul className="divide-y divide-white/10 rounded bg-flix-panel">
              {group.map((d) => (
                <DownloadRow key={d.episodeId} item={d} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function DownloadRow({ item }: { item: DownloadItem }) {
  const update = useLiveDownloads()[item.episodeId];
  const status = update?.status ?? item.status;
  const subtitle = item.titleType === 'series' ? `${item.titleName} · S${item.seasonNumber}` : item.titleName;
  const detail =
    status === 'downloading' && update
      ? update.stage === 'merging'
        ? 'Merging video and audio…'
        : [
            update.stage ? `${update.stage === 1 ? 'Video' : 'Audio'} stream` : null,
            update.speed ? `${formatBytes(update.speed)}/s` : null,
            update.eta != null ? `${formatClock(update.eta)} left` : null,
          ]
            .filter(Boolean)
            .join(' · ')
      : status === 'error'
        ? (update?.error ?? item.error)
        : [formatDuration(item.duration), formatBytes(item.fileSize)].filter(Boolean).join(' · ');

  return (
    <li className="flex items-center gap-4 p-3">
      {item.thumbnail && <img src={item.thumbnail} alt="" className="aspect-video w-28 shrink-0 rounded object-cover" />}
      <div className="min-w-0 flex-1">
        <Link to={`/?t=${item.titleId}`} className="block truncate font-semibold hover:underline">
          {item.episodeName}
        </Link>
        <p className="truncate text-xs text-white/50">{subtitle}</p>
        <p className={`mt-1 truncate text-xs ${status === 'error' ? 'text-red-300' : 'text-white/60'}`}>{detail}</p>
        {status === 'downloading' && (
          <div className="mt-1.5 h-1 overflow-hidden rounded bg-white/15">
            <div className="h-full bg-flix-red transition-all" style={{ width: `${update?.percent ?? 0}%` }} />
          </div>
        )}
      </div>
      <DownloadControl episode={asEpisode(item)} />
    </li>
  );
}
