import { Film, Loader2, Tv } from 'lucide-react';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { formatDuration } from '../format';
import { useCatalog } from '../store';
import type { Preview, TitleType } from '../types';

type SeriesTarget = 'new' | number;

export function AddTitle() {
  const navigate = useNavigate();
  const { titles, reload } = useCatalog();
  const series = titles.filter((t) => t.type === 'series');

  const [url, setUrl] = useState('');
  const [type, setType] = useState<TitleType>('movie');
  const [importAs, setImportAs] = useState<'playlist' | 'video'>('playlist');
  const [seriesMode, setSeriesMode] = useState<'season' | 'series'>('season');
  const [target, setTarget] = useState<SeriesTarget>('new');
  const [seasonNumber, setSeasonNumber] = useState('');
  const [autoDownload, setAutoDownload] = useState(true);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState<'preview' | 'save' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.settings().then((s) => setAutoDownload(s.autoDownload)).catch(() => undefined);
  }, []);

  const hasBoth = Boolean(preview?.parsed.videoId && preview?.parsed.playlistId);
  const isPlaylist = preview?.source.kind === 'playlist';

  const loadPreview = async (as = importAs) => {
    if (!url.trim()) return;
    setLoading('preview');
    setError(null);
    try {
      const p = await api.preview(url.trim(), as);
      setPreview(p);
      if (p.source.kind === 'playlist' && p.detectedSeasons && p.detectedSeasons > 1) {
        setType('series');
        setSeriesMode('series');
      } else if (p.source.kind === 'playlist') {
        setType('series');
      }
    } catch (err) {
      setPreview(null);
      setError((err as Error).message);
    } finally {
      setLoading(null);
    }
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!preview) return loadPreview();
    setLoading('save');
    setError(null);
    try {
      const addingSeason = type === 'series' && target !== 'new';
      const { titleId } = await api.importTitle({
        url: url.trim(),
        type,
        importAs: hasBoth ? importAs : undefined,
        seriesMode: addingSeason ? 'season' : seriesMode,
        seriesId: addingSeason ? (target as number) : undefined,
        seasonNumber: seasonNumber ? Number(seasonNumber) : undefined,
        autoDownload,
      });
      await reload();
      navigate(`/?t=${titleId}`);
    } catch (err) {
      setError((err as Error).message);
      setLoading(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 pb-16 pt-24">
      <h1 className="text-3xl font-black">Add to catalog</h1>
      <p className="mt-1 text-white/60">Paste a YouTube video or playlist link.</p>

      <form onSubmit={save} className="mt-8 space-y-6">
        <div className="flex gap-2">
          <input
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setPreview(null);
            }}
            onBlur={() => !preview && void loadPreview()}
            placeholder="https://www.youtube.com/playlist?list=…"
            className="flex-1 rounded border border-white/20 bg-black/60 px-4 py-3 outline-none focus:border-white/60"
            autoFocus
          />
          <button
            type="button"
            onClick={() => void loadPreview()}
            disabled={!url.trim() || loading !== null}
            className="rounded bg-white/15 px-5 font-semibold hover:bg-white/25 disabled:opacity-40"
          >
            {loading === 'preview' ? <Loader2 className="animate-spin" size={20} /> : 'Preview'}
          </button>
        </div>

        {error && <p className="rounded bg-flix-red/20 px-4 py-3 text-sm text-red-200">{error}</p>}

        {preview && (
          <>
            <PreviewCard preview={preview} />

            {hasBoth && (
              <Choice label="This link has a video and a playlist. Import:">
                <Pill active={importAs === 'playlist'} onClick={() => { setImportAs('playlist'); void loadPreview('playlist'); }}>
                  The whole playlist
                </Pill>
                <Pill active={importAs === 'video'} onClick={() => { setImportAs('video'); void loadPreview('video'); }}>
                  Only this video
                </Pill>
              </Choice>
            )}

            <Choice label="What is it?">
              <Pill active={type === 'movie'} onClick={() => setType('movie')}>
                <Film size={16} /> Movie{isPlaylist ? ' (in parts)' : ''}
              </Pill>
              <Pill active={type === 'series'} onClick={() => setType('series')}>
                <Tv size={16} /> Series
              </Pill>
            </Choice>

            {type === 'series' && (
              <>
                {series.length > 0 && (
                  <Choice label="Add to">
                    <select
                      value={String(target)}
                      onChange={(e) => setTarget(e.target.value === 'new' ? 'new' : Number(e.target.value))}
                      className="rounded border border-white/30 bg-black px-3 py-2 text-sm"
                    >
                      <option value="new">A new series</option>
                      {series.map((s) => (
                        <option key={s.id} value={s.id}>
                          New season of “{s.name}”
                        </option>
                      ))}
                    </select>
                  </Choice>
                )}

                {target === 'new' && isPlaylist && (
                  <Choice label="This playlist is">
                    <Pill active={seriesMode === 'season'} onClick={() => setSeriesMode('season')}>
                      One season
                    </Pill>
                    <Pill active={seriesMode === 'series'} onClick={() => setSeriesMode('series')}>
                      The whole series
                    </Pill>
                    {seriesMode === 'series' && (
                      <p className="w-full text-xs text-white/50">
                        {preview.detectedSeasons
                          ? `Found ${preview.detectedSeasons} season(s) from titles like “S01E02” — episodes will be split automatically.`
                          : 'No season markers (S01E02, T1E2, 1x02…) found in the titles, so everything goes into Season 1.'}
                      </p>
                    )}
                  </Choice>
                )}

                {(target !== 'new' || seriesMode === 'season') && (
                  <Choice label="Season number">
                    <input
                      type="number"
                      min={0}
                      value={seasonNumber}
                      onChange={(e) => setSeasonNumber(e.target.value)}
                      placeholder={target === 'new' ? '1' : 'next'}
                      className="w-24 rounded border border-white/30 bg-black px-3 py-2 text-sm"
                    />
                  </Choice>
                )}
              </>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={autoDownload} onChange={(e) => setAutoDownload(e.target.checked)} className="accent-flix-red" />
              {type === 'series'
                ? 'Start downloading the first episode now (the rest via "Download all")'
                : 'Start downloading the MP4 files now'}
            </label>

            <button
              disabled={loading !== null}
              className="flex items-center gap-2 rounded bg-flix-red px-8 py-3 font-semibold hover:bg-flix-red-dark disabled:opacity-50"
            >
              {loading === 'save' && <Loader2 className="animate-spin" size={18} />}
              Add to catalog
            </button>
          </>
        )}
      </form>
    </div>
  );
}

function PreviewCard({ preview }: { preview: Preview }) {
  const { source } = preview;
  const entries = source.kind === 'playlist' ? source.playlist.entries : [source.video];
  const name = source.kind === 'playlist' ? source.playlist.title : source.video.title;
  const thumbnail = source.kind === 'playlist' ? source.playlist.thumbnail : source.video.thumbnail;
  const channel = source.kind === 'playlist' ? source.playlist.channel : source.video.channel;
  const total = entries.reduce((sum, e) => sum + (e.duration ?? 0), 0);

  return (
    <div className="overflow-hidden rounded-lg bg-flix-panel">
      <div className="flex gap-4 p-4">
        {thumbnail && <img src={thumbnail} alt="" className="aspect-video w-48 shrink-0 rounded object-cover" />}
        <div className="min-w-0">
          <p className="text-lg font-bold">{name}</p>
          <p className="mt-1 text-sm text-white/60">
            {[channel, source.kind === 'playlist' ? `${entries.length} videos` : null, formatDuration(total)]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>
      {source.kind === 'playlist' && (
        <ol className="max-h-56 overflow-y-auto border-t border-white/10 px-4 py-2 text-sm text-white/70">
          {entries.map((e, i) => (
            <li key={e.youtubeId} className="flex justify-between gap-4 py-1">
              <span className="truncate">
                {i + 1}. {e.title}
              </span>
              <span className="shrink-0 text-white/40">{formatDuration(e.duration)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Choice({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm text-white/60">{label}</p>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition ${
        active ? 'border-white bg-white text-black' : 'border-white/30 hover:border-white/70'
      }`}
    >
      {children}
    </button>
  );
}
