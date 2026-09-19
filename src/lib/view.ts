/**
 * The view as a path.
 *
 * A URL should name the thing it shows, and be editable by hand:
 *
 *   /{org}/{repo}/{commit}/packages/{package}/functions
 *
 * Reads as: this repository, at this commit, that package, its functions. Every
 * prefix of it is also a valid address, which is what makes it hackable — cut
 * the last segment and you are one level out.
 */
export type LevelId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export interface View {
  /** `owner/name`, as GitHub spells it. */
  repo: string;
  /** Abbreviated commit, or null for head. */
  ref: string | null;
  level: LevelId;
  /** Package name, not node id — `deka_http`, not `pkg:deka_http`. */
  pkg: string | null;
  /** File path relative to the repository. */
  file: string | null;
  /**
   * A symbol to bring to the top of the elevation, from the fragment.
   *
   * A fragment rather than another path segment, because that is exactly what
   * a fragment is for: the path names the document and the fragment names a
   * place inside it. It also keeps the path grammar intact — every prefix of
   * one of these addresses is still a valid address, which would stop being
   * true the moment a symbol name with a slash in it became a segment.
   */
  focus: string | null;
}

/** The word that names each elevation in a path. */
const WORD: Record<LevelId, string> = {
  L0: 'score',
  L1: 'system',
  L2: 'packages',
  L3: 'files',
  L4: 'types',
  L5: 'functions',
};

const LEVEL_OF: Record<string, LevelId> = Object.fromEntries(
  Object.entries(WORD).map(([level, word]) => [word, level as LevelId]),
) as Record<string, LevelId>;

/** A lens that can follow a scope: types and functions are views of one thing. */
const LENS = new Set(['types', 'functions']);

export const defaultView = (repo: string): View => ({
  repo,
  ref: null,
  level: 'L0',
  pkg: null,
  file: null,
  focus: null,
});

/** Commit-ish: hex, long enough to mean something, never a keyword. */
const looksLikeRef = (segment: string): boolean =>
  /^[0-9a-f]{7,40}$/.test(segment) && !(segment in LEVEL_OF);

export function parsePath(pathname: string, hash: string, fallbackRepo: string): View {
  const focus = hash.replace(/^#/, '');
  const parts = pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts.length < 2) return defaultView(fallbackRepo);

  const view = defaultView(`${parts[0]}/${parts[1]}`);
  if (focus) view.focus = decodeURIComponent(focus);
  let rest = parts.slice(2);

  if (rest.length > 0 && looksLikeRef(rest[0]!)) {
    view.ref = rest[0]!;
    rest = rest.slice(1);
  }
  if (rest.length === 0) return view;

  // A lens may close the address, and a file path never ends in one — paths end
  // in a file name. So the tail is read first.
  let lens: LevelId | null = null;
  const last = rest[rest.length - 1]!;
  if (rest.length > 1 && LENS.has(last)) {
    lens = LEVEL_OF[last]!;
    rest = rest.slice(0, -1);
  }

  const head = rest[0]!;
  if (head === 'packages') {
    view.level = 'L2';
    if (rest[1]) {
      view.pkg = rest[1];
      // A package shows its files, unless a lens asked for something else.
      view.level = lens ?? 'L3';
      if (rest[2] === 'files' && rest.length > 3) {
        view.file = rest.slice(3).join('/');
        view.level = lens ?? 'L4';
      }
    }
  } else if (LEVEL_OF[head]) {
    view.level = LEVEL_OF[head]!;
  }
  return view;
}

export function toPath(view: View): string {
  const parts: string[] = [view.repo];
  if (view.ref) parts.push(view.ref);

  if (view.pkg) {
    parts.push('packages', view.pkg);
    if (view.file) parts.push('files', view.file);
    // At a scope, the level is a lens on it — and the default needs no word.
    const implied: LevelId = view.file ? 'L4' : 'L3';
    if (view.level !== implied && LENS.has(WORD[view.level])) parts.push(WORD[view.level]);
  } else if (view.level !== 'L0') {
    parts.push(WORD[view.level]);
  }

  const path = '/' + parts.map((p) => p.split('/').map(encodeURIComponent).join('/')).join('/');
  return view.focus ? `${path}#${encodeURIComponent(view.focus)}` : path;
}

export const sameView = (a: View, b: View): boolean =>
  a.repo === b.repo &&
  a.ref === b.ref &&
  a.level === b.level &&
  a.pkg === b.pkg &&
  a.file === b.file &&
  a.focus === b.focus;
