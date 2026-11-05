import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { DownloadsTabs } from '../components/DownloadsTabs';
import { formatBytes } from '../format';
import { useCatalog } from '../store';
import type { StorageFile, StorageSummary, StorageTitle } from '../types';

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

  const titleRows = (type: StorageTitle['type']): RankedRow[] =>
    titles
      .filter((t) => t.type === type)
      .map((t) => ({
        key: `title-${t.id}`,
        name: t.name,
        link: `?t=${t.id}`,
        detail: [plural(t.fileCount, 'file'), t.freeableBytes < t.bytes ? `deleting frees ${formatBytes(t.freeableBytes) || '0 B'}` : null]
          .filter(Boolean)
          .join(' · '),
        bytes: t.bytes,
        disabledReason: t.freeableBytes === 0 ? 'Other titles use all of these files. Delete them from "Largest files".' : null,
        onDelete: () => onDelete(t.episodeIds, confirmTitleDelete(t)),
      }));

  const fileRows: RankedRow[] = files.map((f) => ({
    key: `file-${f.episodeIds[0]}`,
    name: f.name,
    link: `?t=${f.titles[0].id}`,
    detail: f.titles.map((t) => t.name).join(', '),
    bytes: f.bytes,
    disabledReason: null,
    onDelete: () => onDelete(f.episodeIds, confirmFileDelete(f)),
  }));

  return (
    <>
      <Overview summary={summary} />
      <RankedList heading="Largest series" rows={titleRows('series')} total={totalBytes} deleting={deleting} />
      <RankedList heading="Largest movies" rows={titleRows('movie')} total={totalBytes} deleting={deleting} />
      <RankedList heading="Largest files" rows={fileRows} total={totalBytes} deleting={deleting} />
    </>
  );
}

function Overview({ summary: { totalBytes, fileCount, split } }: { summary: StorageSummary }) {
  const parts = [
    { label: 'Series', bytes: split.series, color: 'bg-chart-blue' },
    { label: 'Movies', bytes: split.movie, color: 'bg-chart-orange' },
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
  name: string;
  link: string;
  detail: string;
  bytes: number;
  /** Set when deleting would free nothing. */
  disabledReason: string | null;
  onDelete: () => void;
}

function RankedList({ heading, rows, total, deleting }: { heading: string; rows: RankedRow[]; total: number; deleting: boolean }) {
  const [showAll, setShowAll] = useState(false);
  if (!rows.length) return null;
  const visible = showAll ? rows : rows.slice(0, TOP_ROWS);
  const largest = rows[0].bytes;
  return (
    <section className="mt-8">
      <h2 className="mb-2 text-lg font-semibold text-white/80">
        {heading} <span className="text-white/40">({rows.length})</span>
      </h2>
      <ul className="divide-y divide-white/10 rounded bg-flix-panel">
        {visible.map((row) => (
          <RankedItem key={row.key} row={row} largest={largest} total={total} deleting={deleting} />
        ))}
      </ul>
      {rows.length > TOP_ROWS && (
        <button onClick={() => setShowAll((v) => !v)} className="mt-2 text-sm text-white/60 hover:text-white">
          {showAll ? 'Show fewer' : `Show all ${rows.length}`}
        </button>
      )}
    </section>
  );
}

function RankedItem({ row, largest, total, deleting }: { row: RankedRow; largest: number; total: number; deleting: boolean }) {
  const { local } = useAuth();
  const share = formatShare(row.bytes, total);
  const size = formatBytes(row.bytes) || '0 B';
  return (
    <li className="flex items-center gap-4 p-3 hover:bg-white/5" title={`${size} (${row.bytes.toLocaleString()} bytes), ${share} of the total`}>
      <div className="min-w-0 flex-1">
        <Link to={row.link} className="block truncate font-semibold hover:underline">
          {row.name}
        </Link>
        <p className="truncate text-xs text-white/50">{row.detail}</p>
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
          title={row.disabledReason ?? `Delete downloads of ${row.name}`}
          aria-label={`Delete downloads of ${row.name}`}
          className="shrink-0 rounded p-2 text-white/60 hover:bg-flix-red/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
        >
          <Trash2 size={18} />
        </button>
      )}
    </li>
  );
}
