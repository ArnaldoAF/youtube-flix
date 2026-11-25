// Spots movies that look like parts of one story ("… Part 1", "… Part 2", "Saga II") so the app can
// suggest a collection. It only suggests; nothing is grouped without the user's confirmation.

export interface DetectInput {
  id: number;
  type: 'movie' | 'series';
  name: string;
  channel: string | null;
  inCollection: boolean;
}

export interface Suggestion {
  /** The shared part of the titles, as written in the first movie. */
  name: string;
  /** Movies in story order. */
  titleIds: number[];
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Same story when these keys match: case, accents and punctuation do not matter. */
const baseKey = (base: string) => fold(base).replace(/[^a-z0-9]+/g, ' ').trim();

const MARKER = /^(.*?)[\s\-–—:|,.]*\b(?:part|parte|pt\.?|chapter|cap[ií]tulo|cap\.?|vol(?:ume)?\.?)\s*(\d{1,3}|[ivx]{1,4})\s*$/i;
// A bare trailing number is only a part when it is a single digit: "Apollo 13" and "Windows 10" are names.
const TRAILING = /^(.*?\S)[\s\-–—:]+([1-9]|ii|iii|iv|v|vi|vii|viii|ix|x)\s*$/i;

/**
 * The story name and part number of a title, or null without a part marker. Text in brackets
 * ("(Finale)", "(1902)") is ignored. A title without any number counts as part 1 when its sequels
 * exist ("Saga", "Saga II"), which the grouping step decides.
 */
export function parsePart(name: string): { base: string; number: number } | null {
  const plain = name.replace(/\s*[([{][^)\]}]*[)\]}]/g, '').trim();
  const m = plain.match(MARKER) ?? plain.match(TRAILING);
  if (!m) return null;
  const raw = m[2].toLowerCase();
  const number = /^\d+$/.test(raw) ? Number(raw) : ROMAN[raw];
  const base = m[1].replace(/[\s\-–—:|,.]+$/, '').trim();
  return number && base ? { base, number } : null;
}

export function suggestCollections(titles: DetectInput[]): Suggestion[] {
  const free = titles.filter((t) => t.type === 'movie' && !t.inCollection && t.channel);
  const groups = new Map<string, { base: string; id: number; number: number }[]>();
  free.forEach((t) => {
    const part = parsePart(t.name);
    const plain = t.name.replace(/\s*[([{][^)\]}]*[)\]}]/g, '').trim();
    // An unnumbered title can be part 1 of a numbered sequel with the same name.
    const entry = part ?? { base: plain, number: 1 };
    const key = `${t.channel}\u0000${baseKey(entry.base)}`;
    groups.set(key, [...(groups.get(key) ?? []), { base: entry.base, id: t.id, number: entry.number }]);
  });
  return [...groups.values()]
    // A repeated part number (a re-upload, an HD copy) keeps the first one listed.
    .map((members) => members.filter((m, i) => members.findIndex((x) => x.number === m.number) === i))
    .map((members) => [...members].sort((a, b) => a.number - b.number))
    .filter((ordered) => ordered.length >= 2 && isRun(ordered.map((m) => m.number)))
    .map((ordered) => ({ name: ordered[0].base, titleIds: ordered.map((m) => m.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Parts must follow on without gaps (1, 2, 3 or 2, 3): "Windows" and "Windows 7" are not a saga. */
const isRun = (sorted: number[]) => sorted.every((n, i) => i === 0 || n === sorted[i - 1] + 1);
