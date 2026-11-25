import { ArrowDown, ArrowDownUp, ArrowUp, Check, Pencil, RotateCcw, Trash2, X } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Episode, Season } from '../types';

const ORDER_NOTE: Record<Season['orderMode'], string> = {
  playlist: 'Same order as the YouTube playlist.',
  reversed: 'YouTube playlist order, reversed. New videos land in the right place.',
  manual: 'Your own order. New videos from the playlist are added at the end.',
};

type Run = (label: string, fn: () => Promise<unknown>) => Promise<void>;

/**
 * "Edit episodes" for one season: reverse the order, move episodes up or down, rename them, and (on
 * this PC) remove them or bring removed videos back. `removable` is false for a title's last episode.
 */
export function EpisodeEditor({ season, local, removable, run }: { season: Season; local: boolean; removable: boolean; run: Run }) {
  const ids = season.episodes.map((e) => e.id);

  const move = (index: number, by: -1 | 1) => {
    const next = [...ids];
    [next[index], next[index + by]] = [next[index + by], next[index]];
    void run('order', () => api.reorderSeason(season.id, next));
  };

  const remove = (episode: Episode) => {
    if (!confirm(`Remove "${episode.name}" from this series? It will not come back when the playlist is checked.`)) return;
    const deleteFile = episode.hasLocalFile && confirm('Also delete its downloaded video from disk?');
    void run('remove', () => api.deleteEpisode(episode.id, !deleteFile));
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded bg-white/5 px-3 py-2 text-sm">
        <span className="text-white/70">{ORDER_NOTE[season.orderMode]}</span>
        <button
          type="button"
          onClick={() => void run('reverse', () => api.reverseSeason(season.id))}
          className="flex items-center gap-2 rounded bg-white/15 px-3 py-1.5 hover:bg-white/25"
        >
          <ArrowDownUp size={16} aria-hidden /> Reverse order
        </button>
      </div>

      <ol className="divide-y divide-white/10 border-t border-white/10">
        {season.episodes.map((episode, i) => (
          <EditableRow
            key={episode.id}
            episode={episode}
            first={i === 0}
            last={i === season.episodes.length - 1}
            canRemove={local && removable}
            onMove={(by) => move(i, by)}
            onSave={(patch) => run('edit', () => api.updateEpisode(episode.id, patch))}
            onRemove={() => remove(episode)}
          />
        ))}
      </ol>

      {season.removed.length > 0 && (
        <div className="text-sm">
          <h4 className="mb-2 font-semibold text-white/70">Removed from this season ({season.removed.length})</h4>
          <ul className="space-y-1">
            {season.removed.map((r) => (
              <li key={r.youtubeId} className="flex items-center justify-between gap-3 rounded bg-white/5 px-3 py-2">
                <span className="min-w-0 truncate text-white/70">{r.name || r.youtubeId}</span>
                {local && (
                  <button
                    type="button"
                    title="It comes back the next time the playlist is checked"
                    onClick={() => void run('restore', () => api.restoreVideo(season.id, r.youtubeId))}
                    className="flex shrink-0 items-center gap-1.5 rounded px-2 py-1 text-white/80 hover:bg-white/15 hover:text-white"
                  >
                    <RotateCcw size={14} aria-hidden /> Restore
                  </button>
                )}
              </li>
            ))}
          </ul>
          {local && <p className="mt-2 text-xs text-white/40">A restored video comes back the next time the playlist is checked.</p>}
        </div>
      )}
    </div>
  );
}

function EditableRow({
  episode,
  first,
  last,
  canRemove,
  onMove,
  onSave,
  onRemove,
}: {
  episode: Episode;
  first: boolean;
  last: boolean;
  canRemove: boolean;
  onMove: (by: -1 | 1) => void;
  onSave: (patch: { name: string; description: string }) => Promise<void>;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(episode.name);
  const [description, setDescription] = useState(episode.description);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    await onSave({ name: name.trim(), description });
    setEditing(false);
  };

  const field = 'w-full rounded border border-white/20 bg-black/60 px-3 py-2 text-sm outline-none focus:border-white/60';
  const small = 'flex h-8 w-8 items-center justify-center rounded hover:bg-white/15 disabled:opacity-25 disabled:hover:bg-transparent';

  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        <span className="w-6 shrink-0 text-center text-lg text-white/60">{episode.position}</span>
        <img src={episode.thumbnail ?? undefined} alt="" loading="lazy" className="aspect-video w-20 shrink-0 rounded object-cover md:w-28" />
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{episode.name}</p>
        <div className="flex shrink-0 items-center">
          <button type="button" aria-label="Move up" title="Move up" disabled={first} onClick={() => onMove(-1)} className={small}>
            <ArrowUp size={16} />
          </button>
          <button type="button" aria-label="Move down" title="Move down" disabled={last} onClick={() => onMove(1)} className={small}>
            <ArrowDown size={16} />
          </button>
          <button
            type="button"
            aria-label="Edit name and description"
            title="Edit name and description"
            onClick={() => {
              // Start from the current text: the episode may have changed since this row first showed.
              setName(episode.name);
              setDescription(episode.description);
              setEditing((v) => !v);
            }}
            className={small}
          >
            <Pencil size={16} />
          </button>
          {canRemove && (
            <button type="button" aria-label="Remove from series" title="Remove from series" onClick={onRemove} className={`${small} hover:text-red-300`}>
              <Trash2 size={16} />
            </button>
          )}
        </div>
      </div>
      {editing && (
        <form onSubmit={save} className="mt-3 space-y-2 pl-9">
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={300} aria-label="Episode name" className={field} />
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} aria-label="Episode description" className={field} />
          <div className="flex gap-2">
            <button className="flex items-center gap-1.5 rounded bg-white px-3 py-1.5 text-sm font-semibold text-black hover:bg-white/80">
              <Check size={16} /> Save
            </button>
            <button
              type="button"
              onClick={() => {
                setName(episode.name);
                setDescription(episode.description);
                setEditing(false);
              }}
              className="flex items-center gap-1.5 rounded px-3 py-1.5 text-sm text-white/70 hover:text-white"
            >
              <X size={16} /> Cancel
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
