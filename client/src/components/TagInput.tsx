import { Plus, X } from 'lucide-react';
import { useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

const MAX_TAG_LENGTH = 40;
/** Same limit the server enforces on PATCH /titles/:id. */
const MAX_TAGS = 30;

interface Option {
  value: string;
  create: boolean;
}

/** Keeps focus in the input so a button press doesn't trigger the commit-on-blur first. */
const keepFocus = (e: MouseEvent) => e.preventDefault();

/**
 * Chip-style tag editor. Enter or comma adds exactly what was typed; a suggestion is used only
 * after picking it with the arrow keys or the mouse. Backspace on an empty input removes the last
 * tag. Tags used by other titles are offered as suggestions, reusing their exact spelling.
 */
export function TagInput({
  value,
  onChange,
  suggestions,
}: {
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const [draft, setDraft] = useState('');
  const [open, setOpen] = useState(false);
  /** -1 = nothing picked, so Enter commits the typed text. */
  const [highlight, setHighlight] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);

  const has = (tag: string) => value.some((t) => t.toLowerCase() === tag.toLowerCase());
  const full = value.length >= MAX_TAGS;
  const query = draft.trim().toLowerCase();
  const available = suggestions.filter((s) => !has(s));
  // Exact match first, then prefix matches, then anything containing the text.
  const rank = (s: string) => (s.toLowerCase() === query ? 0 : s.toLowerCase().startsWith(query) ? 1 : 2);
  const matches = available.filter((s) => s.toLowerCase().includes(query)).sort((a, b) => rank(a) - rank(b));
  const canCreate = query.length > 0 && !has(query) && !available.some((s) => s.toLowerCase() === query);
  const options: Option[] = [
    ...matches.map((s) => ({ value: s, create: false })),
    ...(canCreate ? [{ value: draft.trim(), create: true }] : []),
  ];
  const showMenu = open && query.length > 0 && options.length > 0 && !full;

  const addAll = (raws: string[], rest = '') => {
    const next = raws.reduce<string[]>((tags, raw) => {
      const typed = raw.trim().slice(0, MAX_TAG_LENGTH);
      if (!typed || tags.length >= MAX_TAGS) return tags;
      // "comedy" becomes "Comedy" if that tag already exists, so rows don't split by casing.
      const tag = suggestions.find((s) => s.toLowerCase() === typed.toLowerCase()) ?? typed;
      return tags.some((t) => t.toLowerCase() === tag.toLowerCase()) ? tags : [...tags, tag];
    }, value);
    if (next.length !== value.length) onChange(next);
    setDraft(rest);
    setHighlight(-1);
  };
  const add = (raw: string) => addAll([raw]);

  const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add(showMenu && highlight >= 0 ? options[highlight].value : draft);
    } else if (e.key === ',') {
      e.preventDefault();
      add(draft);
    } else if (e.key === 'Backspace' && !draft && value.length) {
      remove(value[value.length - 1]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHighlight((h) => Math.min(h + 1, options.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === 'Escape') {
      setOpen(false);
      setHighlight(-1);
    }
  };

  return (
    <div>
      <div
        className="relative flex flex-wrap items-center gap-1.5 rounded border border-white/20 bg-black/60 px-2 py-1.5 focus-within:border-white/60"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-full bg-white/15 py-0.5 pl-3 pr-1 text-sm">
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onMouseDown={keepFocus}
              onClick={() => remove(tag)}
              className="rounded-full p-0.5 text-white/60 hover:bg-white/20 hover:text-white"
            >
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          value={draft}
          // No maxLength: it would truncate a pasted "A, B, C" list before it is split. addAll caps each tag.
          onChange={(e) => {
            const v = e.target.value;
            // Pasting "Comedy, Anime" adds both.
            if (v.includes(',')) {
              const parts = v.split(',');
              addAll(parts.slice(0, -1), parts[parts.length - 1]);
            } else {
              setDraft(v);
              setHighlight(-1);
            }
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // A tag typed without pressing Enter is kept, e.g. when clicking Save right away.
            add(draft);
            setOpen(false);
          }}
          placeholder={full ? `Maximum of ${MAX_TAGS} tags` : value.length ? '' : 'Type a tag and press Enter'}
          className="min-w-32 flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-white/40"
        />

        {showMenu && (
          <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-y-auto rounded border border-white/20 bg-flix-panel py-1 shadow-xl">
            {options.map((o, i) => (
              <li key={`${o.create ? 'new:' : ''}${o.value}`}>
                <button
                  type="button"
                  onMouseDown={keepFocus}
                  onClick={() => add(o.value)}
                  className={`flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm ${
                    i === highlight ? 'bg-white/15' : 'hover:bg-white/10'
                  } ${o.create ? 'text-white/70' : ''}`}
                >
                  {o.create ? (
                    <>
                      <Plus size={14} /> Create “{o.value}”
                    </>
                  ) : (
                    o.value
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {available.length > 0 && !full && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-white/40">Your tags:</span>
          {available.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={keepFocus}
              onClick={() => add(s)}
              className="flex items-center gap-1 rounded-full border border-white/25 px-2.5 py-0.5 text-xs text-white/70 hover:border-white/60 hover:text-white"
            >
              <Plus size={11} /> {s}
            </button>
          ))}
        </div>
      )}
      {full && <p className="mt-1 text-xs text-white/50">Maximum of {MAX_TAGS} tags reached.</p>}
    </div>
  );
}
