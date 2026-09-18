/**
 * Getting a repository's source into the browser.
 *
 * Not the tarball endpoint: it sends no CORS headers, so a page cannot fetch one
 * however convenient a single request would be. The route that works is the
 * tree, which is one API call and names every file with the id of its contents,
 * and then those contents from raw.githubusercontent.com — a CDN, which is
 * neither metered nor origin-restricted.
 *
 * Measured against a 330-file workspace: 270ms for the tree, 4.4s for the files
 * at twelve in flight, and one request spent out of an hour's sixty. A visitor
 * brings their own allowance, so nothing here needs a token, a proxy or a
 * bucket.
 */

export interface SourceFile {
  path: string;
  /** The git object id of these contents, which is what makes caching work. */
  blob: string;
  content: string;
}

export interface Progress {
  stage: 'tree' | 'contents' | 'analysing';
  done: number;
  total: number;
  /** Files served from cache rather than fetched. */
  cached: number;
}

/** Manifests, the lockfile, and the code. */
export const isInteresting = (path: string): boolean =>
  path.endsWith('.rs') ||
  path.endsWith('/Cargo.toml') ||
  path === 'Cargo.toml' ||
  path.endsWith('/Cargo.lock') ||
  path === 'Cargo.lock';

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

export interface Tree {
  /** The commit this tree belongs to. */
  sha: string;
  files: TreeEntry[];
  /** GitHub caps a tree response; beyond that the listing is incomplete. */
  truncated: boolean;
}

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (response.status === 403 || response.status === 429) {
    const reset = response.headers.get('x-ratelimit-reset');
    const when = reset ? new Date(Number(reset) * 1000).toLocaleTimeString() : 'shortly';
    throw new Error(`GitHub rate limit reached — it resets at ${when}. Signing in would raise it.`);
  }
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return (await response.json()) as T;
}

/** The commits a time machine offers, newest first. One request. */
export async function fetchCommits(repo: string, count: number) {
  const commits = await api<
    { sha: string; commit: { message: string; author: { name: string; date: string } } }[]
  >(`${API}/repos/${repo}/commits?per_page=${count}`);
  return commits.map((c) => ({
    sha: c.sha,
    short: c.sha.slice(0, 8),
    subject: c.commit.message.split('\n')[0] ?? '',
    author: c.commit.author.name,
    date: c.commit.author.date,
  }));
}

/** Every file in a commit, with the id of its contents. One request. */
export async function fetchTree(repo: string, ref: string): Promise<Tree> {
  const tree = await api<{ sha: string; truncated: boolean; tree: TreeEntry[] }>(
    `${API}/repos/${repo}/git/trees/${ref}?recursive=1`,
  );
  return {
    sha: tree.sha,
    truncated: tree.truncated,
    files: tree.tree.filter((e) => e.type === 'blob' && isInteresting(e.path)),
  };
}

/**
 * Contents are addressed by their git object id, which never changes — so a
 * cached entry can never be stale and never needs revalidating. Between two
 * commits of a repository this is most of the work avoided: on a workspace of
 * three hundred files, a commit typically changes fewer than ten.
 */
const CACHE = 'cqx-blobs-v1';

async function openCache(): Promise<Cache | null> {
  try {
    return await caches.open(CACHE);
  } catch {
    // Private windows and blocked storage: fetch everything, cache nothing.
    return null;
  }
}

export async function fetchSource(
  repo: string,
  tree: Tree,
  onProgress?: (p: Progress) => void,
): Promise<SourceFile[]> {
  const cache = await openCache();
  const files: SourceFile[] = [];
  let done = 0;
  let cached = 0;
  const report = () =>
    onProgress?.({ stage: 'contents', done, total: tree.files.length, cached });

  const queue = [...tree.files];
  const worker = async () => {
    for (let entry = queue.pop(); entry; entry = queue.pop()) {
      const key = `https://cqx.invalid/blob/${entry.sha}`;
      let content: string | null = null;
      try {
        const hit = await cache?.match(key);
        if (hit) {
          content = await hit.text();
          cached++;
        }
      } catch {
        // A cache that misbehaves is a cache miss.
      }
      if (content === null) {
        const response = await fetch(`${RAW}/${repo}/${tree.sha}/${entry.path}`);
        if (!response.ok) {
          done++;
          report();
          continue;
        }
        content = await response.text();
        try {
          await cache?.put(key, new Response(content));
        } catch {
          // Storage full or unavailable; the analysis does not depend on it.
        }
      }
      files.push({ path: entry.path, blob: entry.sha, content });
      done++;
      report();
    }
  };

  onProgress?.({ stage: 'contents', done: 0, total: tree.files.length, cached: 0 });
  // Twelve at a time: enough to saturate an HTTP/2 connection, few enough to
  // leave the page responsive.
  await Promise.all(Array.from({ length: 12 }, worker));
  return files;
}
