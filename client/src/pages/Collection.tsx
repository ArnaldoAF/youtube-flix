import { Layers, Pencil, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { collectionGroups, GRID } from '../browse';
import { TitleCard } from '../components/TitleCard';
import { useCatalog } from '../store';

/** One collection: its movies in story order. Renaming is open to the household; deleting is PC-only. */
export function Collection() {
  const { id = '' } = useParams();
  const { titles, loading, error, reload } = useCatalog();
  const { local } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  if (loading) return <div className="pt-40 text-center text-white/50">Loading…</div>;
  if (error) return <div className="pt-40 text-center text-red-300">Could not reach the server: {error}</div>;

  const group = collectionGroups(titles).find((c) => c.id === Number(id));
  if (!group) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <h1 className="text-2xl font-black">Collection not found</h1>
        <p className="mt-2 text-white/60">It may have been deleted, or lost its other movies.</p>
        <Link to="/movies" className="mt-6 rounded bg-white/15 px-5 py-2 hover:bg-white/25">
          Back to Movies
        </Link>
      </div>
    );
  }

  const rename = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    try {
      await api.updateCollection(group.id, { name });
      await reload();
      setEditing(false);
    } catch (err) {
      setProblem((err as Error).message);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the collection “${group.name}”? Its ${group.movies.length} movies stay in your catalog.`)) return;
    try {
      await api.deleteCollection(group.id);
      await reload();
      navigate('/movies');
    } catch (err) {
      setProblem((err as Error).message);
    }
  };

  return (
    <div className="px-4 pb-16 pt-24 md:px-12">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.3em] text-flix-red">
        <Layers size={14} aria-hidden /> Collection
      </p>
      {editing ? (
        <form onSubmit={rename} className="mt-2 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="collection-name">
            Collection name
          </label>
          <input
            id="collection-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            className="min-w-0 flex-1 rounded border border-white/30 bg-black/60 px-3 py-2 text-xl font-bold outline-none focus:border-white/70"
          />
          <button className="rounded bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-white/80">Save</button>
          <button type="button" onClick={() => setEditing(false)} className="rounded bg-white/15 px-4 py-2 text-sm hover:bg-white/25">
            Cancel
          </button>
        </form>
      ) : (
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-black md:text-4xl">{group.name}</h1>
          <button
            onClick={() => {
              setName(group.name);
              setEditing(true);
            }}
            aria-label="Rename collection"
            title="Rename"
            className="rounded p-2 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <Pencil size={18} />
          </button>
          {local && (
            <button onClick={remove} aria-label="Delete collection" title="Delete collection" className="rounded p-2 text-white/60 hover:bg-flix-red/20 hover:text-white">
              <Trash2 size={18} />
            </button>
          )}
        </div>
      )}
      <p className="mt-2 text-sm text-white/60">{group.movies.length} movies, in order. Change a movie's place or collection from its Edit form.</p>
      {problem && <p className="mt-3 rounded bg-flix-red/20 px-3 py-2 text-sm text-red-200">{problem}</p>}
      <div className={`${GRID} mt-8`}>
        {group.movies.map((t) => (
          <TitleCard key={t.id} title={t} wide />
        ))}
      </div>
    </div>
  );
}
