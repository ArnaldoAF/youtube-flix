import { Database, Download, FileUp, Loader2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { formatBytes } from '../format';
import { useCatalog } from '../store';
import type { ImportMode, ImportSummary } from '../types';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function describeMerge(s: ImportSummary): string {
  const parts = [
    s.addedTitles ? `adds ${plural(s.addedTitles, 'new title')}` : null,
    s.updatedTitles ? `adds to ${plural(s.updatedTitles, 'existing title')}` : null,
    s.addedEpisodes ? `${plural(s.addedEpisodes, 'new episode')} in all` : null,
    s.progressUpdated ? `updates watch progress for ${plural(s.progressUpdated, 'episode')}` : null,
    s.collectionsAdded ? `adds or extends ${plural(s.collectionsAdded, 'collection')}` : null,
  ].filter(Boolean);
  if (!parts.length) return 'Nothing new: everything in this file is already in your catalog.';
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}. Nothing is removed.`;
}

function describeReplace(s: ImportSummary): string {
  const { titles, episodes, withProgress } = s.incoming;
  const unlinked = s.unlinked.files
    ? ` ${plural(s.unlinked.files, 'downloaded video')} (${formatBytes(s.unlinked.bytes) || '0 B'}) stay on disk but will no longer be listed.`
    : '';
  return `This file has ${plural(titles, 'title')}, ${plural(episodes, 'episode')} and watch progress for ${plural(withProgress, 'episode')}. It replaces your current ${plural(s.removedTitles, 'title')}.${unlinked}`;
}

const describe = (s: ImportSummary) => (s.mode === 'merge' ? describeMerge(s) : describeReplace(s));

const relinkNote = (s: ImportSummary) =>
  s.relinkedVideos ? ` ${plural(s.relinkedVideos, 'episode')} will play from videos already on this PC.` : '';

/** Settings → Catalog: export to a file, and import one by merging or replacing. */
export function CatalogTransfer() {
  const { reload } = useCatalog();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [merge, setMerge] = useState(true);
  const [preview, setPreview] = useState<ImportSummary | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'preview' | 'import' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const mode: ImportMode = merge ? 'merge' : 'replace';
  // Only the latest preview may land: switching modes quickly must not show the older answer.
  const latest = useRef(0);

  useEffect(() => {
    if (!file) return;
    const id = ++latest.current;
    setPreview(null);
    setPreviewError(null);
    setMessage(null);
    setBusy('preview');
    api
      .previewCatalogImport(file, mode)
      .then((s) => id === latest.current && setPreview(s))
      .catch((err: Error) => id === latest.current && setPreviewError(err.message))
      .finally(() => id === latest.current && setBusy(null));
  }, [file, mode]);

  const reset = () => {
    latest.current += 1;
    setFile(null);
    // Back to the safe choice: the next file starts as a merge, never as a leftover replace.
    setMerge(true);
    setPreview(null);
    setPreviewError(null);
    setBusy(null);
    if (input.current) input.current.value = '';
  };

  const choose = (chosen: File | null) => {
    setMessage(null);
    setMerge(true);
    setFile(chosen);
  };

  // The button only acts on a preview of the mode shown, never on one left over from the other mode.
  const ready = preview !== null && preview.mode === mode && busy === null;

  const confirm = async () => {
    if (!file || !ready) return;
    setBusy('import');
    try {
      const result = await api.importCatalog(file, mode);
      const done = result.mode === 'merge' ? 'Catalog merged.' : 'Catalog replaced.';
      setMessage({ ok: true, text: `${done} ${describe(result)}${relinkNote(result)}\nThe previous catalog was saved as ${result.backup}` });
      reset();
      await reload();
    } catch (err) {
      setMessage({ ok: false, text: (err as Error).message });
      setBusy(null);
    }
  };

  const button = 'flex items-center gap-2 rounded bg-white/15 px-4 py-2 text-sm hover:bg-white/25 disabled:opacity-50';

  return (
    <section>
      <h2 className="mb-1 flex items-center gap-2 text-lg font-semibold">
        <Database aria-hidden size={20} /> Catalog
      </h2>
      <p className="mb-3 text-sm text-white/60">
        Move your titles and watch progress to another computer. Downloaded videos, the household password and this PC's folders stay here.
      </p>
      <div className="space-y-4 rounded bg-flix-panel p-4 text-sm">
        <a href={api.catalogExportUrl} download className={`${button} w-fit`}>
          <Download size={16} /> Export catalog
        </a>

        <div className="border-t border-white/10 pt-4">
          <input ref={input} type="file" accept=".db" className="hidden" onChange={(e) => choose(e.target.files?.[0] ?? null)} />
          <button type="button" onClick={() => input.current?.click()} disabled={busy === 'import'} className={button}>
            <FileUp size={16} /> {file ? 'Choose another file' : 'Import catalog…'}
          </button>

          {file && (
            <div className="mt-4 space-y-3">
              <p className="truncate text-white/70">{file.name}</p>
              <label className="flex items-start gap-2">
                <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} disabled={busy === 'import'} className="mt-0.5 accent-flix-red" />
                <span>
                  Merge with my current catalog
                  <span className="block text-xs text-white/50">
                    {merge ? 'Adds what is new and keeps everything you have.' : 'Unticked: your catalog will be replaced by this file.'}
                  </span>
                </span>
              </label>

              <p
                className={`rounded px-3 py-2 ${previewError ? 'bg-flix-red/20 text-red-200' : merge ? 'bg-white/5' : 'bg-flix-red/15 text-red-100'}`}
                aria-live="polite"
              >
                {previewError ??
                  (preview && preview.mode === mode ? (
                    `${describe(preview)}${relinkNote(preview)}`
                  ) : (
                    <span className="flex items-center gap-2 text-white/60">
                      <Loader2 size={14} className="animate-spin" /> Reading the file…
                    </span>
                  ))}
              </p>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={confirm}
                  disabled={!ready}
                  className={`flex items-center gap-2 rounded px-4 py-2 font-semibold disabled:opacity-50 ${
                    merge ? 'bg-white text-black hover:bg-white/80' : 'bg-flix-red hover:bg-flix-red-dark'
                  }`}
                >
                  {busy === 'import' && <Loader2 size={16} className="animate-spin" />}
                  {merge ? 'Merge into catalog' : 'Replace catalog'}
                </button>
                <button type="button" onClick={reset} disabled={busy === 'import'} className={button}>
                  Cancel
                </button>
              </div>
              <p className="text-xs text-white/40">A backup of your current catalog is saved first.</p>
            </div>
          )}
        </div>

        {message && (
          <p className={`whitespace-pre-line rounded px-3 py-2 ${message.ok ? 'bg-emerald-500/15 text-emerald-200' : 'bg-flix-red/20 text-red-200'}`}>
            {message.text}
          </p>
        )}
      </div>
    </section>
  );
}
