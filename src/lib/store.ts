/**
 * Where a repository's datasets come from.
 *
 * `cqx export` writes a directory, and this reads one:
 *
 *   <org>/<repo>/index.json      the timeline
 *   <org>/<repo>/<commit>.json   that commit, and only that commit
 *
 * Where to read one from is declared, not discovered. A deployment that
 * exported datasets beside itself says so in its manifest; everything else
 * falls through to the shared store — explorer.deka.gg has one at
 * cqxdata.deka.gg, a bucket with CORS and a domain — and anything neither has
 * seen is analysed in the browser from the repository itself.
 *
 * Declaring it rather than probing for it matters under a single-page
 * fallback, where an unmatched path is answered with the page: a probe cannot
 * 404, so every miss costs a full round trip and is then thrown away.
 *
 * A dataset is named by its commit and describes nothing else, so it is
 * immutable: once fetched it can be cached forever and never revalidated.
 */

import type { Commit, Dataset } from 'cqx-kit/engine';

/** The shared store. A deployment overrides it; an empty value disables it. */
export const STORE: string = (
  import.meta.env.PUBLIC_CQX_STORE ?? 'https://cqxdata.deka.gg'
).replace(/\/$/, '');

/**
 * Where this deployment keeps its own datasets, if it keeps any. Set from the
 * manifest, which is the only thing that knows — `cqx export --out public/data`
 * beside a build writes `"store": "/data"` into it.
 */
let declared: string | null = null;

export function useStore(base: string | null) {
  declared = base ? base.replace(/\/$/, '') : null;
}

export interface RepoIndex {
  repo: string;
  branch: string;
  remote: string | null;
  commits_url: string | null;
  generated: string;
  /** Oldest first, as the walk produced them. */
  commits: Commit[];
}

/**
 * A single-page fallback answers an unmatched path with the page itself, so a
 * missing file arrives as 200 with HTML rather than as a 404. Content type is
 * the only thing that tells the difference.
 */
async function json<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    if (!(response.headers.get('content-type') ?? '').includes('json')) return null;
    return (await response.json()) as T;
  } catch {
    // A bucket that is not configured, offline, or refusing the origin.
    return null;
  }
}

const bases = (): string[] => [declared, STORE].filter((b): b is string => !!b);

async function first<T>(path: string): Promise<T | null> {
  for (const base of bases()) {
    const value = await json<T>(`${base}/${path}`);
    if (value) return value;
  }
  return null;
}

export const loadIndex = (repo: string): Promise<RepoIndex | null> =>
  first<RepoIndex>(`${repo}/index.json`);

export const loadDataset = (repo: string, commit: string): Promise<Dataset | null> =>
  first<Dataset>(`${repo}/${commit}.json`);
