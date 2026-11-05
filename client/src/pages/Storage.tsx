import { ChevronDown, FileVideo, Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { DownloadsTabs } from '../components/DownloadsTabs';
import { TitleTypeIcon } from '../components/TitleTypeIcon';
import { formatBytes } from '../format';
import { useCatalog } from '../store';
import type { StorageFile, StorageSummary, StorageTitle, TitleType } from '../types';

const TOP_ROWS = 10;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function formatShare(bytes: number, total: number): string {
  if (!total) return '0%';
  const percent = (bytes / total) * 100;
  return percent > 0 && percent < 1 ? '<1%' : `${Math.round(percent)}%`;
}

const AFTER_DELETE = 'It stays in your catalog and plays from YouTube. You can download it again while the video is still there.';

function confirmTitleDelete(title: StorageTitle): string {
  return [
    `Delete ${plural(title.fileCount, 'downloaded file')} of "${title.name}"? This frees ${formatBytes(title.freeableBytes)}.`,
    title.freeableBytes < title.bytes ? 'Files other titles also use stay on disk.' : null,
    title.pendingCount ? `${plural(title.pendingCount, 'unfinished download')} will also be cancelled.` : null,
    AFTER_DELETE,
  ]
    .filter(Boolean)
    .join('\n\n');
}

function confirmFileDelete(file: StorageFile): string {
  return [
    `Delete "${file.name}"? This frees ${formatBytes(file.bytes)}.`,
    file.titles.length > 1 ? `It is used by several titles and will be removed from all of them: ${file.titles.map((t) => t.name).join(', ')}.` : null,
    AFTER_DELETE,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export function Storage() {
  const [summary, setSummary] = useState<StorageSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { version, reload } = useCatalog();

  const load = useCallback(async () => {
    try {
      setSummary(await api.storage());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // The catalog version changes whenever a download finishes or a file is removed.
  useEffect(() => {
    void load();
  }, [load, version]);

  const remove = async (episodeIds: number[], question: string) => {
    if (!confirm(question)) return;
    setDeleting(true);
    try {
      await api.deleteFiles(episodeIds);
      await load();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-24">
      <DownloadsTabs />
      {error && <p className="mt-6 rounded bg-flix-red/20 px-3 py-2 text-sm text-red-200">{error}</p>}
      {!summary && !error && <p className="mt-6 text-white/60">Loading…</p>}
      {summary?.fileCount === 0 && <p className="mt-6 text-white/60">No downloaded files yet, so nothing is using disk space.</p>}
      {summary && summary.fileCount > 0 && <StorageReport summary={summary} deleting={deleting} onDelete={remove} />}
    </div>
  );
}

type OnDelete = (episodeIds: number[], question: string) => void;

function StorageReport({ summary, deleting, onDelete }: { summary: StorageSummary; deleting: boolean; onDelete: OnDelete }) {
  const { totalBytes, titles, files } = summary;

  /** Inside a series the row links to that series and says so, since episode names repeat across series. */
  const fileRow = (f: StorageFile, detail: string, series?: StorageTitle): RankedRow => ({
    key: `file-${f.episodeIds[0]}`,
    name: f.name,
    link: `?t=${(series ?? f.titles[0]).id}`,
    detail,
    bytes: f.bytes,
    deleteLabel: series ? `Delete the file of ${f.name} in ${series.name}` : `Delete the file of ${f.name}`,
    disabledReason: null,
    onDelete: () => onDelete(f.episodeIds, confirmFileDelete(f)),
  });

  /** Files are already largest first. A file another title shares says so, since deleting it affects both. */
  const episodeRows = (t: StorageTitle): RankedRow[] =>
    files
      .filter((f) => f.titles.some((owner) => owner.id === t.id))
      .map((f) => {
        const others = f.titles.filter((owner) => owner.id !== t.id).map((owner) => owner.name);
        return fileRow(f, others.length ? `Also in ${others.join(', ')}` : '', t);
      });

  const titleRows = (type: TitleType): RankedRow[] =>
    titles
      .filter((t) => t.type === type)
      .map((t) => ({
        key: `title-${t.id}`,
        type,
        name: t.name,
        link: `?t=${t.id}`,
        detail: [plural(t.fileCount, 'file'), t.freeableBytes < t.bytes ? `deleting frees ${formatBytes(t.freeableBytes) || '0 B'}` : null]
          .filter(Boolean)
          .join(' · '),
        bytes: t.bytes,
        deleteLabel: `Delete downloads of ${t.name}`,
        disabledReason: t.freeableBytes === 0 ? 'Other titles use all of these files. Delete them from "Largest files".' : null,
        onDelete: () => onDelete(t.episodeIds, confirmTitleDelete(t)),
        episodes: type === 'series' ? episodeRows(t) : undefined,
      }));

  const fileRows = files.map((f) => ({
    ...fileRow(f, f.titles.map((t) => t.name).join(', ')),
    type: f.titles[0].type,
  }));

  return (
    <>
      <Overview summary={summary} />
      <RankedList heading="Largest series" icon={<TitleTypeIcon type="series" size={20} />} rows={titleRows('series')} total={totalBytes} deleting={deleting} />
      <RankedList heading="Largest movies" icon={<TitleTypeIcon type="movie" size={20} />} rows={titleRows('movie')} total={totalBytes} deleting={deleting} />
      <RankedList heading="Largest files" icon={<FileVideo aria-hidden size={20} className="shrink-0" />} rows={fileRows} total={totalBytes} deleting={deleting} />
    </>
  );
}

function Overview({ summary: { totalBytes, fileCount, split } }: { summary: StorageSummary }) {
  const parts: { type: TitleType; label: string; bytes: number; color: string }[] = [
    { type: 'series', label: 'Series', bytes: split.series, color: 'bg-chart-blue' },
    { type: 'movie', label: 'Movies', bytes: split.movie, color: 'bg-chart-orange' },
  ];
  return (
    <section className="mt-8 rounded bg-flix-panel p-5">
      <p className="text-5xl font-black md:text-6xl">{formatBytes(totalBytes)}</p>
      <p className="mt-1 text-sm text-white/60">Used by {plural(fileCount, 'downloaded file')}</p>
      <div
        role="img"
        aria-label={parts.map((p) => `${p.label} ${formatBytes(p.bytes) || '0 B'}`).join(', ')}
        className="mt-5 flex h-2 gap-0.5"
      >
        {parts
          .filter((p) => p.bytes > 0)
          .map((p) => (
            <div
              key={p.label}
              className={`${p.color} min-w-0.5 rounded-sm`}
              style={{ flexGrow: p.bytes, flexBasis: 0 }}
              title={`${p.label}: ${formatBytes(p.bytes)} (${formatShare(p.bytes, totalBytes)})`}
            />
          ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-white/70">
            <span aria-hidden className={`h-2.5 w-2.5 rounded-sm ${p.color}`} />
            <TitleTypeIcon type={p.type} />
            {p.label}
            <span className="font-semibold tabular-nums text-white">{formatBytes(p.bytes) || '0 B'}</span>
            <span className="tabular-nums text-white/50">{formatShare(p.bytes, totalBytes)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

interface RankedRow {
  key: string;
  /** Shows the series or movie icon; episodes inside a series leave it out. */
  type?: TitleType;
  name: string;
  link: string;
  detail: string;
  bytes: number;
  deleteLabel: string;
  /** Set when deleting would free nothing. */
  disabledReason: string | null;
  onDelete: () => void;
  /** Largest first. When set, the row expands to list them. */
  episodes?: RankedRow[];
}

/** Remembered per browser, so a collapsed section stays collapsed when switching tabs. */
function useSectionOpen(key: string): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(key, next ? 'open' : 'closed');
    } catch {
      // Blocked storage only means the choice isn't remembered.
    }
  };
  return [open, toggle];
}

function Chevron({ open, size = 20 }: { open: boolean; size?: number }) {
  return <ChevronDown aria-hidden size={size} className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />;
}

function RankedList({ heading, icon, rows, total, deleting }: { heading: string; icon: ReactNode; rows: RankedRow[]; total: number; deleting: boolean }) {
  const [showAll, setShowAll] = useState(false);
  const [open, toggle] = useSectionOpen(`ytf.storage.section.${heading}`);
  if (!rows.length) return null;
  const visible = showAll ? rows : rows.slice(0, TOP_ROWS);
  const largest = rows[0].bytes;
  return (
    <section className="mt-8">
      <h2 className="mb-2">
        <button
          onClick={toggle}
          aria-expanded={open}
          className="flex w-full items-center gap-2 text-left text-lg font-semibold text-white/80 hover:text-white"
        >
          {icon}
          <span>
            {heading} <span className="text-white/40">({rows.length})</span>
          </span>
          <span className="ml-auto">
            <Chevron open={open} />
          </span>
        </button>
      </h2>
      {open && (
        <ul className="divide-y divide-white/10 rounded bg-flix-panel">
          {visible.map((row) => (
            <RankedItem key={row.key} row={row} largest={largest} total={total} deleting={deleting} />
          ))}
        </ul>
      )}
      {open && rows.length > TOP_ROWS && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-sm text-white/60 hover:text-white">
          {showAll ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

function RankedItem({ row, largest, total, deleting }: { row: RankedRow; largest: number; total: number; deleting: boolean }) {
  const { local } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const episodes = row.episodes ?? [];
  const share = formatShare(row.bytes, total);
  const size = formatBytes(row.bytes) || '0 B';
  return (
    <li>
      <div className="flex items-center gap-3 p-3 hover:bg-white/5 sm:gap-4" title={`${size} (${row.bytes.toLocaleString()} bytes), ${share} of the total`}>
        {episodes.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} episodes of ${row.name}`}
            title={`${expanded ? 'Hide' : 'Show'} episodes`}
            className="-mx-1 shrink-0 rounded p-1 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <Chevron open={expanded} />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <Link to={row.link} className="flex items-center gap-2 font-semibold hover:underline">
            {row.type && <TitleTypeIcon type={row.type} className="text-white/60" />}
            <span className="truncate">{row.name}</span>
          </Link>
          {row.detail && <p className="truncate text-xs text-white/50">{row.detail}</p>}
          <div aria-hidden className="mt-2 h-1.5 overflow-hidden rounded-sm">
            <div className="h-full rounded-sm bg-chart-blue" style={{ width: `${largest ? (row.bytes / largest) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="w-20 shrink-0 text-right">
          <p className="whitespace-nowrap text-lg font-bold tabular-nums">{size}</p>
          <p className="text-xs tabular-nums text-white/50">{share}</p>
        </div>
        {local && (
          <button
            onClick={row.onDelete}
            disabled={deleting || row.disabledReason !== null}
            title={row.disabledReason ?? row.deleteLabel}
            aria-label={row.deleteLabel}
            className="shrink-0 rounded p-2 text-white/60 hover:bg-flix-red/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
          >
            <Trash2 size={18} />
          </button>
        )}
      </div>
      {expanded && episodes.length > 0 && (
        <div className="border-t border-white/10 bg-black/25 pl-4 sm:pl-10">
          <p className="px-3 pt-2 text-xs font-semibold uppercase tracking-wide text-white/40">Episodes, largest first</p>
          <ul className="divide-y divide-white/10">
            {episodes.map((episode) => (
              <RankedItem key={episode.key} row={episode} largest={episodes[0].bytes} total={total} deleting={deleting} />
            ))}
          </ul>
        </div>
      )}
    </li>
  );
}
