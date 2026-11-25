import { collectionGroups, type CollectionGroup } from '../browse';
import type { TitleSummary } from '../types';
import { api } from '../api';

/** What the Edit form asks for: no collection, a place in an existing one, or a new one with a second movie. */
export type CollectionChoice =
  | { kind: 'none' }
  | { kind: 'existing'; id: number; position: number }
  | { kind: 'new'; name: string; partnerId: number | null };

export function initialChoice(title: TitleSummary): CollectionChoice {
  return title.collection ? { kind: 'existing', id: title.collection.id, position: title.collection.position } : { kind: 'none' };
}

const without = (group: CollectionGroup, titleId: number) => group.movies.map((m) => m.id).filter((id) => id !== titleId);

/** Applies the choice with the fewest changes. Leaving a two-movie collection dissolves it (the server's rule). */
export async function applyCollectionChoice(title: TitleSummary, choice: CollectionChoice, titles: TitleSummary[]): Promise<void> {
  const groups = collectionGroups(titles);
  const current = title.collection ? groups.find((g) => g.id === title.collection?.id) : undefined;
  const staying = choice.kind === 'existing' && choice.id === current?.id;

  if (current && !staying) await api.updateCollection(current.id, { titleIds: without(current, title.id) });

  if (choice.kind === 'existing') {
    const target = groups.find((g) => g.id === choice.id);
    if (!target) return;
    const others = without(target, title.id);
    const at = Math.min(Math.max(choice.position, 1), others.length + 1) - 1;
    const next = [...others.slice(0, at), title.id, ...others.slice(at)];
    const unchanged = staying && next.join(',') === target.movies.map((m) => m.id).join(',');
    if (!unchanged) await api.updateCollection(target.id, { titleIds: next });
  }

  if (choice.kind === 'new') {
    if (!choice.partnerId) throw new Error('Pick a second movie for the new collection');
    await api.createCollection(choice.name, [title.id, choice.partnerId]);
  }
}

const field = 'w-full rounded border border-white/20 bg-black/60 px-3 py-2 text-sm outline-none focus:border-white/60';

export function CollectionField({
  title,
  titles,
  choice,
  onChange,
}: {
  title: TitleSummary;
  titles: TitleSummary[];
  choice: CollectionChoice;
  onChange: (c: CollectionChoice) => void;
}) {
  const groups = collectionGroups(titles);
  const free = titles.filter((t) => t.type === 'movie' && t.id !== title.id && !t.collection).sort((a, b) => a.name.localeCompare(b.name));
  const selectValue = choice.kind === 'existing' ? `c:${choice.id}` : choice.kind;
  const target = choice.kind === 'existing' ? groups.find((g) => g.id === choice.id) : undefined;
  const places = target ? without(target, title.id).length + 1 : 0;

  const pick = (value: string) => {
    if (value === 'none') return onChange({ kind: 'none' });
    if (value === 'new') return onChange({ kind: 'new', name: '', partnerId: free[0]?.id ?? null });
    const id = Number(value.slice(2));
    const group = groups.find((g) => g.id === id);
    const keep = title.collection?.id === id ? title.collection.position : (group ? without(group, title.id).length + 1 : 1);
    onChange({ kind: 'existing', id, position: keep });
  };

  return (
    <div className="space-y-2 text-sm">
      <label className="block">
        <span className="mb-1 block text-white/60">Collection (movies that continue each other, like Part 1 and Part 2)</span>
        <select value={selectValue} onChange={(e) => pick(e.target.value)} className={field}>
          <option value="none">Not in a collection</option>
          {groups.map((g) => (
            <option key={g.id} value={`c:${g.id}`}>
              {g.name} ({g.movies.length} movies)
            </option>
          ))}
          <option value="new">New collection…</option>
        </select>
      </label>
      {choice.kind === 'existing' && target && (
        <label className="block">
          <span className="mb-1 block text-white/60">Place in the collection</span>
          <select value={choice.position} onChange={(e) => onChange({ ...choice, position: Number(e.target.value) })} className={field}>
            {Array.from({ length: places }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
      )}
      {choice.kind === 'new' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-white/60">Collection name</span>
            <input value={choice.name} onChange={(e) => onChange({ ...choice, name: e.target.value })} required maxLength={200} className={field} />
          </label>
          <label className="block">
            <span className="mb-1 block text-white/60">Together with (comes after this movie)</span>
            <select
              value={choice.partnerId ?? ''}
              onChange={(e) => onChange({ ...choice, partnerId: e.target.value ? Number(e.target.value) : null })}
              className={field}
            >
              {free.length === 0 && <option value="">No other movie is free</option>}
              {free.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
