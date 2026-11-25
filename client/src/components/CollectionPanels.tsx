import { Layers, Loader2, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { collectionPath, dismissedSuggestions, dismissSuggestion, isDismissed } from '../browse';
import { useCatalog } from '../store';
import type { CollectionSuggestion, TitleSummary } from '../types';

/** "Part of X": the movies of this title's collection in order, with the current one marked. */
export function CollectionInfo({ title }: { title: TitleSummary }) {
  const { titles } = useCatalog();
  const ref = title.collection;
  if (!ref) return null;
  const movies = titles
    .filter((t) => t.collection?.id === ref.id)
    .sort((a, b) => (a.collection?.position ?? 0) - (b.collection?.position ?? 0));
  return (
    <div className="mt-4 rounded bg-white/5 p-3 text-sm">
      <p className="flex items-center gap-2 text-white/70">
        <Layers size={16} aria-hidden /> Part of{' '}
        <Link to={collectionPath(ref.id)} className="font-semibold text-white underline-offset-2 hover:underline">
          {ref.name}
        </Link>
        <span className="text-white/50">· {ref.size} movies</span>
      </p>
      <ol className="mt-2 space-y-1">
        {movies.map((m, i) => (
          <li key={m.id} className="flex gap-2">
            <span className="w-5 text-right text-white/40">{i + 1}.</span>
            {m.id === title.id ? (
              <span className="font-semibold">
                {m.name} <span className="text-xs font-normal text-white/50">(this movie)</span>
              </span>
            ) : (
              <Link to={`?t=${m.id}`} className="text-white/80 underline-offset-2 hover:text-white hover:underline">
                {m.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** "Next: Part 2" beside Play, when this movie has a following one in its collection. */
export function NextInCollectionButton({ title }: { title: TitleSummary }) {
  const { titles } = useCatalog();
  const navigate = useNavigate();
  const ref = title.collection;
  // The first later movie with something to play; an empty one in between is skipped.
  const next = ref
    ? titles
        .filter((t) => t.collection?.id === ref.id && t.collection.position > ref.position && t.episodeCount > 0)
        .sort((a, b) => (a.collection?.position ?? 0) - (b.collection?.position ?? 0))[0]
    : undefined;
  if (!next) return null;
  return (
    <button
      onClick={async () => navigate(`/watch/${(await api.playTarget(next.id)).episodeId}`)}
      title={`Play ${next.name}`}
      className="flex max-w-[16rem] items-center gap-2 rounded bg-white/20 px-4 py-2 font-semibold backdrop-blur hover:bg-white/30"
    >
      <SkipForward size={18} fill="currentColor" aria-hidden />
      <span className="truncate">Next: {next.name}</span>
    </button>
  );
}

/** Fetches detection suggestions that the user has not dismissed in this browser. */
export function useSuggestions(): [CollectionSuggestion[], () => void] {
  const { version } = useCatalog();
  const [list, setList] = useState<CollectionSuggestion[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    api
      .collectionSuggestions()
      .then((all) => {
        const dismissed = dismissedSuggestions();
        setList(all.filter((s) => !isDismissed(s.titleIds, dismissed)));
      })
      .catch(() => setList([]));
  }, [version, tick]);
  return [list, () => setTick((t) => t + 1)];
}

/** "These look like parts of one story. Create the collection …?" with Create and Not now. */
export function SuggestionPrompt({ suggestion, onDone }: { suggestion: CollectionSuggestion; onDone: () => void }) {
  const { titles, reload } = useCatalog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const names = suggestion.titleIds.map((id) => titles.find((t) => t.id === id)?.name).filter(Boolean);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.createCollection(suggestion.name, suggestion.titleIds);
      await reload();
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const notNow = () => {
    dismissSuggestion(suggestion.titleIds);
    onDone();
  };

  return (
    <div className="rounded border border-white/15 bg-white/5 p-3 text-sm">
      <p className="flex items-center gap-2 font-semibold">
        <Layers size={16} aria-hidden /> These look like parts of one story
      </p>
      <p className="mt-1 text-white/70">
        Create the collection <span className="font-semibold text-white">{suggestion.name}</span> with {names.length} movies:{' '}
        {names.join(' → ')}?
      </p>
      {error && <p className="mt-2 text-red-300">{error}</p>}
      <div className="mt-3 flex gap-2">
        <button onClick={create} disabled={busy} className="flex items-center gap-2 rounded bg-white px-3 py-1.5 font-semibold text-black hover:bg-white/80 disabled:opacity-60">
          {busy && <Loader2 size={14} className="animate-spin" />} Create
        </button>
        <button onClick={notNow} disabled={busy} className="rounded bg-white/15 px-3 py-1.5 hover:bg-white/25">
          Not now
        </button>
      </div>
    </div>
  );
}
