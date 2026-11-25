import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { useCatalog } from '../store';
import type { TitleDetail } from '../types';
import { applyCollectionChoice, CollectionField, initialChoice, type CollectionChoice } from './CollectionField';
import { TagInput } from './TagInput';

export function EditTitleForm({ title, onDone }: { title: TitleDetail; onDone: () => void }) {
  const { titles } = useCatalog();
  const [name, setName] = useState(title.name);
  const [description, setDescription] = useState(title.description);
  const [tags, setTags] = useState(title.tags);
  const knownTags = [...new Set(titles.flatMap((t) => t.tags))].sort((a, b) => a.localeCompare(b));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [collection, setCollection] = useState<CollectionChoice>(() => initialChoice(title));
  const isMovie = title.type === 'movie';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.updateTitle(title.id, {
        name: name.trim(),
        description,
        tags,
      });
      if (isMovie) await applyCollectionChoice(title, collection, titles);
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const field = 'w-full rounded border border-white/20 bg-black/60 px-3 py-2 text-sm outline-none focus:border-white/60';
  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block text-sm">
        <span className="mb-1 block text-white/60">Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={300} className={field} />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-white/60">Description</span>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={5} className={field} />
      </label>
      <div className="text-sm">
        <span className="mb-1 block text-white/60">Genres (each genre becomes a row on Home, a filter and a source of recommendations)</span>
        <TagInput value={tags} onChange={setTags} suggestions={knownTags} />
      </div>
      {isMovie && <CollectionField title={title} titles={titles} choice={collection} onChange={setCollection} />}
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="flex gap-2">
        <button disabled={saving} className="rounded bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-white/80 disabled:opacity-50">
          Save
        </button>
        <button type="button" onClick={onDone} className="rounded px-5 py-2 text-sm text-white/70 hover:text-white">
          Cancel
        </button>
      </div>
    </form>
  );
}
