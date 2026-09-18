/**
 * The view as a URL.
 *
 * Every navigation is addressable: a link can be shared, the back button works,
 * and a reload returns to where you were. The alternative — state that lives
 * only in memory — makes the browser's own controls lie.
 */
export type LevelId = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export interface View {
  repo: string;
  level: LevelId;
  /** Package node id, e.g. `pkg:cli`. */
  pkg: string | null;
  /** File node id. */
  file: string | null;
  /** Index into the time machine, 0 being head. */
  commit: number;
}

const LEVELS: LevelId[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

export function defaultView(repo: string): View {
  return { repo, level: 'L0', pkg: null, file: null, commit: 0 };
}

export function readView(fallbackRepo: string): View {
  if (typeof window === 'undefined') return defaultView(fallbackRepo);
  const params = new URLSearchParams(window.location.search);
  const level = params.get('at');
  const commit = Number.parseInt(params.get('commit') ?? '', 10);
  return {
    repo: params.get('repo') ?? fallbackRepo,
    level: LEVELS.includes(level as LevelId) ? (level as LevelId) : 'L0',
    pkg: params.get('pkg'),
    file: params.get('file'),
    commit: Number.isFinite(commit) && commit >= 0 ? commit : 0,
  };
}

/** Only what differs from the default is written, so a shared link stays short. */
export function toQuery(view: View, defaultRepo: string): string {
  const params = new URLSearchParams();
  if (view.repo !== defaultRepo) params.set('repo', view.repo);
  if (view.level !== 'L0') params.set('at', view.level);
  if (view.pkg) params.set('pkg', view.pkg);
  if (view.file) params.set('file', view.file);
  if (view.commit !== 0) params.set('commit', String(view.commit));
  const query = params.toString();
  return query ? `?${query}` : window.location.pathname;
}

export const sameView = (a: View, b: View): boolean =>
  a.repo === b.repo &&
  a.level === b.level &&
  a.pkg === b.pkg &&
  a.file === b.file &&
  a.commit === b.commit;
