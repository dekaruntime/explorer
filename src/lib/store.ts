/**
 * Where a repository's datasets come from.
 *
 * `cqx export` writes a directory, and this reads one:
 *
 *   <org>/<repo>/index.json      the timeline
 *   <org>/<repo>/<commit>.json   that commit, and only that commit
 *
 * Three places are tried in order, which is what keeps the explorer neutral.
 * A developer who ran `cqx export` beside their own build is served from it. A
 * deployment with a shared store — explorer.deka.gg has one at cqxdata.deka.gg,
 * a bucket with CORS and a domain — falls through to that. Anything neither has
 * seen is analysed in the browser from the repository itself.
 *
 * A dataset is named by its commit and describes nothing else, so it is
 * immutable: once fetched it can be cached forever and never revalidated.
 */

import type { Commit, Dataset } from './types';

/** The shared store. A deployment overrides it; an empty value disables it. */
export const STORE: string = (
  import.meta.env.PUBLIC_CQX_STORE ?? 'https://cqxdata.deka.gg'
).replace(/\/$/, '');

/** Datasets exported beside this deployment, if there are any. */
const LOCAL = '/data';

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

const bases = (): string[] => (STORE ? [LOCAL, STORE] : [LOCAL]);

async function first<T>(path: string): Promise<{ value: T; from: string } | null> {
  for (const base of bases()) {
    const value = await json<T>(`${base}/${path}`);
    if (value) return { value, from: base };
  }
  return null;
}

export async function loadIndex(repo: string): Promise<RepoIndex | null> {
  const found = await first<RepoIndex>(`${repo}/index.json`);
  return found?.value ?? null;
}

export async function loadDataset(repo: string, commit: string): Promise<Dataset | null> {
  const found = await first<Dataset>(`${repo}/${commit}.json`);
  return found?.value ?? null;
}
