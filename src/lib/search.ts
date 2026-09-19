import type { Dataset } from './types';
import type { View } from './view';

/**
 * Finding one thing in a repository of a hundred thousand.
 *
 * Every elevation is a list, and a list is only navigable while it is short.
 * bevy declares 9,231 types; the Types elevation shows 120 of them, ordered by
 * use, which is the right ordering for reading and useless for looking. The
 * elevations answer "what is this codebase like" and nothing in the explorer
 * answered "where is `SystemParam`" — so this does.
 *
 * It searches what is already in memory. A dataset is one object holding every
 * crate, file, type and function of one commit, so there is nothing to fetch
 * and nothing to index on a server: the whole corpus is a few tens of
 * thousands of strings, and a scan over them costs less than the frame it is
 * drawn in. That is worth saying out loud, because the obvious shape for this
 * feature is a service, and a service here would be slower.
 */

export type HitKind = 'crate' | 'file' | 'type' | 'function';

/** Which order the groups read in: coarse to fine, as the elevations do. */
export const KIND_ORDER: HitKind[] = ['crate', 'file', 'type', 'function'];

export const KIND_LABEL: Record<HitKind, string> = {
  crate: 'crates',
  file: 'files',
  type: 'types',
  function: 'functions',
};

export interface Hit {
  kind: HitKind;
  /** Matched against, and shown first. */
  name: string;
  /** Where it lives — a crate, or the path of a file. */
  where: string;
  /** Anything else worth knowing at a glance, right-aligned. */
  note: string;
  /** The view that shows it. */
  go: Partial<View>;
  key: string;
  score: number;
}

interface Entry extends Omit<Hit, 'score'> {
  lower: string;
  /**
   * The first letter of each word, so `hm` finds `HashMap` and `rts` finds
   * `read_to_string`. Computed once per dataset rather than per keystroke:
   * it is the same string every time, and there are forty thousand of them.
   */
  initials: string;
  /**
   * How much this matters when nothing else separates two matches — uses for
   * a type, size for everything else. Logarithmic, because the difference
   * between one use and ten is worth more than between a hundred and a
   * thousand, and capped so it can never outrank the quality of a match.
   */
  rank: number;
}

export interface Index {
  entries: Entry[];
  /** How many of each kind are searchable. */
  counts: Record<HitKind, number>;
  /**
   * How many exist. Larger than `counts` for types and functions: a dataset
   * carries the declarations a repository owns and the functions that do
   * something notable, not every symbol it parsed. Shown rather than hidden,
   * so an absent result reads as "not in the dataset" rather than "not found".
   */
  totals: Record<HitKind, number>;
}

const SEPARATOR = /[_\-:/.\s]/;

function initialsOf(name: string): string {
  let out = '';
  for (let i = 0; i < name.length; i++) {
    const c = name[i]!;
    const prev = i === 0 ? '' : name[i - 1]!;
    const starts = prev === '' || SEPARATOR.test(prev);
    const camel = c >= 'A' && c <= 'Z' && !(prev >= 'A' && prev <= 'Z');
    if ((starts || camel) && /[A-Za-z0-9]/.test(c)) out += c.toLowerCase();
  }
  return out;
}

/**
 * Whether position `at` begins a word only the original casing can show.
 *
 * The haystack is lowercased so matching is case-insensitive, which erases
 * exactly the boundary `hm` needs to find `HashMap`. The name is kept beside
 * it and consulted here rather than lowercasing on every comparison.
 */
function isCamel(hay: string, at: number, original: string): boolean {
  if (hay.length !== original.length) return false;
  const c = original[at]!;
  const prev = original[at - 1]!;
  return c >= 'A' && c <= 'Z' && !(prev >= 'A' && prev <= 'Z');
}

/** Diminishing returns on size, in `[0, 24]`. */
const weigh = (n: number): number => Math.min(24, Math.log10(Math.max(n, 0) + 1) * 7);

export function buildIndex(data: Dataset): Index {
  const entries: Entry[] = [];
  // A file names its crate by id and a type names it by name. Both are needed:
  // the id to read what a file belongs to, the name to address it.
  const crateOf = new Map(data.packages.map((p) => [p.id, p.name]));

  for (const p of data.packages) {
    entries.push({
      kind: 'crate',
      name: p.name,
      lower: p.name.toLowerCase(),
      initials: initialsOf(p.name),
      where: `${p.files.toLocaleString()} files`,
      note: `${p.lines.toLocaleString()} lines`,
      key: p.id,
      rank: weigh(p.lines),
      go: { pkg: p.name, file: null, level: 'L3' },
    });
  }

  for (const f of data.files) {
    const crate = crateOf.get(f.pkg) ?? null;
    entries.push({
      kind: 'file',
      name: f.path,
      lower: f.path.toLowerCase(),
      initials: initialsOf(f.path),
      where: crate ?? '',
      note: `${f.lines.toLocaleString()} lines`,
      key: f.id,
      rank: weigh(f.lines),
      go: { pkg: crate, file: f.path, level: 'L4' },
    });
  }

  for (const t of data.types) {
    entries.push({
      kind: 'type',
      name: t.name,
      lower: t.name.toLowerCase(),
      initials: initialsOf(t.name),
      where: t.pkg ?? '',
      note: t.uses > 0 ? `${t.uses.toLocaleString()} uses` : t.k,
      key: t.id,
      // A type nothing uses is still a type, and searching for it by name is
      // exactly how you find out that nothing uses it.
      rank: weigh(t.uses * 4),
      go: { pkg: t.pkg, file: t.file, level: 'L4', focus: t.name },
    });
  }

  for (const f of data.functions) {
    entries.push({
      kind: 'function',
      name: f.name,
      lower: f.name.toLowerCase(),
      initials: initialsOf(f.name),
      where: f.pkg ?? '',
      note: f.eff.length ? f.eff.length === 1 ? '1 effect' : `${f.eff.length} effects` : `${f.p.length} params`,
      key: f.id,
      rank: weigh(f.lines),
      go: { pkg: f.pkg, file: f.file, level: 'L5', focus: f.name },
    });
  }

  return {
    entries,
    counts: {
      crate: data.packages.length,
      file: data.files.length,
      type: data.types.length,
      function: data.functions.length,
    },
    totals: {
      crate: data.packages.length,
      file: data.files.length,
      type: data.totals.types,
      function: data.totals.functions,
    },
  };
}

/**
 * How well a candidate answers the query, or 0 for not at all.
 *
 * The tiers are wide apart on purpose. Within a tier the tie-breaks are small
 * adjustments — how much of the name is left over, how far in the match
 * started — so a worse kind of match can never climb over a better one by
 * being short. A reader typing `parse` wants `parse` before `parse_expr`
 * before `try_parse` before `preamble_arse`, and that is the order.
 */
const EXACT = 1000;
const PREFIX = 800;
const INITIALS = 640;
const BOUNDARY = 560;
const CONTAINS = 420;
const SCATTERED = 200;
/**
 * Above this, a match contains what was typed. Below it, the letters merely
 * appear in order. The tiers are far enough apart — and the bonus inside the
 * scattered tier is capped — that the line is exact rather than approximate.
 */
const LOOSE_CEILING = 300;

function rate(needle: string, e: Entry): number {
  const hay = e.lower;
  if (hay === needle) return EXACT;
  if (hay.startsWith(needle)) return PREFIX - Math.min(hay.length - needle.length, 60);
  // Two letters at least: one letter would make every name with that initial
  // an acronym match, which is every name.
  if (needle.length >= 2 && e.initials.startsWith(needle)) {
    return INITIALS - Math.min(e.initials.length - needle.length, 40);
  }
  const at = hay.indexOf(needle);
  if (at > 0) {
    const tier = SEPARATOR.test(hay[at - 1]!) ? BOUNDARY : CONTAINS;
    return tier - Math.min(at, 40);
  }
  // Last resort: the letters in order, anywhere — how somebody types
  // `rts` for `read_to_string`, or `dekahttp` for `deka_http`.
  //
  // Anywhere is far too generous on its own. `enforce` matches
  // `self_contained_inlines_prelude_for_separate_scopes` letter by letter and
  // has nothing whatever to do with it — and in a repository with no better
  // answer, that coincidence is what leads the list.
  //
  // What separates an abbreviation from a coincidence is where the letters
  // land. Someone shortening a name types the start of a word or carries on
  // from where they were: `rts` for `read_to_string`, `hm` for `HashMap`,
  // `readtostring` for the same thing spelled out. Nobody abbreviates by
  // taking the third letter of one word and the second of the next.
  //
  // So every letter has to begin a word or continue the previous match, with
  // no exceptions. That one rule is the whole difference between a tier worth
  // having and a tier that fills the palette with nonsense — `span` stops
  // matching `emit_user_enum_payload_values_are_not_frozen`, while every way
  // a person actually shortens a name still works.
  let from = 0;
  let together = 0;
  for (let i = 0; i < needle.length; i++) {
    const found = hay.indexOf(needle[i]!, from);
    if (found < 0) return 0;
    const runs = i > 0 && found === from;
    const starts = found === 0 || SEPARATOR.test(hay[found - 1]!) || isCamel(hay, found, e.name);
    if (!runs && !starts) return 0;
    if (runs) together++;
    from = found + 1;
  }
  // Capped so the tier cannot climb out of itself: everything scattered stays
  // below LOOSE_CEILING, which is what lets the caller count them.
  return SCATTERED + Math.min(together * 6, 90);
}

/**
 * A crate is a bigger thing than a function of the same name, and there are
 * two hundred times fewer of them — so when both match equally the coarser
 * one leads. Small enough that it only ever breaks a tie.
 */
const KIND_BIAS: Record<HitKind, number> = { crate: 30, type: 12, function: 8, file: 0 };

/**
 * What to show before anything is typed.
 *
 * An empty palette is a dead end: it asks a question without suggesting that
 * any answer exists. The largest crates and the most-used types are both a
 * plausible destination and an honest sample of what is in here.
 */
function opening(index: Index, limit: number): Hit[] {
  const pick = (kind: HitKind, n: number) =>
    index.entries
      .filter((e) => e.kind === kind)
      .sort((a, b) => b.rank - a.rank)
      .slice(0, n)
      .map((e) => ({ ...e, score: e.rank }));
  return [...pick('crate', Math.min(5, limit)), ...pick('type', 5)].slice(0, limit);
}

export function search(index: Index, query: string, limit = 24): Hit[] {
  // Spaces are how people type a name they half-remember — `deka http` for
  // `deka_http` — and the scattered-letters tier already handles the rest.
  const needle = query.toLowerCase().replace(/\s+/g, '');
  if (!needle) return opening(index, limit);

  const found: Hit[] = [];
  const loose: Hit[] = [];
  for (const e of index.entries) {
    const score = rate(needle, e);
    if (score <= 0) continue;
    const hit = { ...e, score: score + KIND_BIAS[e.kind] + e.rank };
    (score > LOOSE_CEILING ? found : loose).push(hit);
  }
  const by = (a: Hit, b: Hit) => b.score - a.score || a.name.length - b.name.length;
  found.sort(by);
  loose.sort(by);
  // Letters-in-order matches earn their place when they are the answer — `rts`
  // for `read_to_string` — and are noise when something better already
  // matched. A path has a word boundary every few characters, so a short query
  // anchors somewhere in half the files in a repository, and those filled the
  // rest of the list under three or four real results. They get a corner of it
  // instead: enough to be found, never enough to bury what was found properly.
  return [...found, ...loose.slice(0, Math.max(4, Math.round(limit / 4)))].slice(0, limit);
}
