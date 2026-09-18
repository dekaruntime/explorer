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

export interface TreeEntry {
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

/**
 * Where the three metered calls go when something is there to answer them.
 *
 * A deployment with a worker holds a token and a bucket: it asks GitHub once
 * per commit and keeps the answer, so the sixty requests an hour an address is
 * allowed are not spent by reading. A deployment without one — a directory
 * served from a laptop — has no such route, and the same calls go to GitHub
 * directly, at sixty an hour.
 *
 * Decided once per page rather than per request, because the answer cannot
 * change while the page is open.
 */
let proxied: Promise<boolean> | null = null;
function viaWorker(): Promise<boolean> {
  proxied ??= fetch('/gh/', { method: 'OPTIONS' })
    .then((r) => r.ok)
    .catch(() => false);
  return proxied;
}

/** Asks the worker, and falls back to GitHub when there is no worker. */
async function metered<T>(path: string, direct: string): Promise<T> {
  if (await viaWorker()) {
    const response = await fetch(`/gh/${path}`);
    if (response.ok) return (await response.json()) as T;
    // A worker that cannot answer says why; passing that on beats retrying
    // against a limit this deployment was built to avoid.
    const why = await response.json().catch(() => ({ error: `worker ${response.status}` }));
    throw new Error((why as { error?: string }).error ?? `worker ${response.status}`);
  }
  return api<T>(`${API}${direct}`);
}

async function api<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (response.status === 403 || response.status === 429) {
    const reset = response.headers.get('x-ratelimit-reset');
    const when = reset
      ? `at ${new Date(Number(reset) * 1000).toLocaleTimeString()}`
      : 'shortly';
    throw new Error(`GitHub rate limit reached — it resets ${when}. Signing in would raise it.`);
  }
  if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
  return (await response.json()) as T;
}

export interface CommitRef {
  sha: string;
  short: string;
  subject: string;
  author: string;
  date: string;
}

/**
 * The one thing here that cannot be cached forever.
 *
 * Everything else is addressed by a commit or a blob and so can never go stale,
 * but a repository grows new commits, and a timeline that hid one would be
 * worse than a request. A minute is short enough that nobody notices and long
 * enough that reloading a page repeatedly — the common case while reading —
 * costs nothing.
 */
const TIMELINES = 'cqx-timelines-v1';
const RELEASES = 'cqx-releases-v1';
const FRESH_FOR = 60_000;

interface Held<T> {
  at: number;
  items: T[];
}

async function openNamed(name: string): Promise<Cache | null> {
  try {
    return await caches.open(name);
  } catch {
    return null;
  }
}

/**
 * A list that is cheap to ask for again and expensive to be wrong about for
 * long: fresh for a minute, and — when GitHub is rate limited or offline —
 * answered from whatever was last held rather than with an error page. Both
 * the commit timeline and the release list are exactly this shape, so they
 * share the one cache strategy rather than each inventing its own.
 */
async function cachedList<T>(
  cacheName: string,
  key: string,
  count: number,
  fetcher: () => Promise<T[]>,
): Promise<T[]> {
  const cache = await openNamed(cacheName);
  let stale: Held<T> | null = null;
  try {
    const hit = await cache?.match(key);
    if (hit) {
      const held = (await hit.json()) as Held<T>;
      if (Date.now() - held.at < FRESH_FOR && held.items.length >= count) {
        return held.items.slice(0, count);
      }
      stale = held;
    }
  } catch {
    // Treat an unreadable cache as an empty one.
  }

  try {
    const items = await fetcher();
    const held: Held<T> = { at: Date.now(), items };
    try {
      await cache?.put(key, new Response(JSON.stringify(held)));
    } catch {
      // Storage full or unavailable; the list is still good for this view.
    }
    return held.items.slice(0, count);
  } catch (e) {
    // Rate limited, or offline. An hour-old list is worth more than an error
    // page — the entries on it are still real, there may just be a newer one
    // missing.
    if (stale) return stale.items.slice(0, count);
    throw e;
  }
}

/** The commits a time machine offers, newest first. One request at most. */
export async function fetchCommits(repo: string, count: number): Promise<CommitRef[]> {
  return cachedList<CommitRef>(
    TIMELINES,
    `https://cqx.invalid/commits/${repo}`,
    count,
    async () => {
      // The worker returns exactly these fields; GitHub returns thirty more
      // per commit, which is why it is worth asking the worker.
      const direct = `/repos/${repo}/commits?per_page=${Math.max(count, 20)}`;
      const commits = await metered<
        CommitRef[] | { sha: string; commit: { message: string; author: { name: string; date: string } } }[]
      >(`${repo}/commits`, direct);
      return commits.map((c) =>
        'commit' in c
          ? {
              sha: c.sha,
              short: c.sha.slice(0, 8),
              subject: c.commit.message.split('\n')[0] ?? '',
              author: c.commit.author.name,
              date: c.commit.author.date,
            }
          : c,
      );
    },
  );
}

export interface ReleaseRef {
  tag: string;
  name: string;
  /** The commit it was cut from, when that could be resolved — null when it
   *  could not (a tag GitHub did not return in the bulk lookup). */
  sha: string | null;
  publishedAt: string;
}

const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * The releases a time machine offers, newest first. One request, plus a
 * second only when needed.
 *
 * `target_commitish` is the field that sounds like the answer, but a release
 * cut by automation usually leaves it as the branch it was cut from (`main`)
 * rather than the commit — GitHub only ever promises "a branch or a commit
 * SHA", not which. Where it is not a full sha, the tag itself is: one bulk
 * request over `/tags` resolves every tag name to the commit it points at, in
 * a single call rather than one per release.
 */
export async function fetchReleases(repo: string, count: number): Promise<ReleaseRef[]> {
  return cachedList<ReleaseRef>(
    RELEASES,
    `https://cqx.invalid/releases/${repo}`,
    count,
    async () => {
      // The worker resolves tags to commits itself, in one request, and hands
      // back only what a rail shows. Without one, both requests happen here.
      const viaProxy = await viaWorker();
      if (viaProxy) {
        const list = await metered<
          { tag: string; sha: string | null; publishedAt: string | null; prerelease: boolean }[]
        >(`${repo}/releases`, `/repos/${repo}/releases?per_page=${Math.max(count, 20)}`);
        return list.map((r) => ({
          tag: r.tag,
          name: r.tag,
          sha: r.sha,
          publishedAt: r.publishedAt ?? '',
        }));
      }
      const releases = await api<
        {
          tag_name: string;
          name: string | null;
          target_commitish: string;
          published_at: string | null;
          created_at: string;
          draft: boolean;
        }[]
      >(`${API}/repos/${repo}/releases?per_page=${Math.max(count, 20)}`);
      const visible = releases.filter((r) => !r.draft);

      const needsLookup = visible.some((r) => !FULL_SHA.test(r.target_commitish));
      let byTag = new Map<string, string>();
      if (needsLookup) {
        try {
          const tags = await api<{ name: string; commit: { sha: string } }[]>(
            `${API}/repos/${repo}/tags?per_page=100`,
          );
          byTag = new Map(tags.map((t) => [t.name, t.commit.sha]));
        } catch {
          // Without the tags, a release with a branch for a target cannot be
          // resolved; it is listed and not offered.
        }
      }
      return visible.map((r) => ({
        tag: r.tag_name,
        name: r.name || r.tag_name,
        sha: FULL_SHA.test(r.target_commitish) ? r.target_commitish : (byTag.get(r.tag_name) ?? null),
        publishedAt: r.published_at ?? r.created_at,
      }));
    },
  );
}

/** Every file in a commit, with the id of its contents. One request. */
export async function fetchTree(repo: string, ref: string): Promise<Tree> {
  // The worker answers this one from the bucket for good once it has answered
  // it once: a commit's files are what they were. It also answers it small —
  // two fields per interesting file, where GitHub sends eight for every file
  // there is. deno's tree is a quarter of a megabyte before that filter.
  const tree = await metered<
    | Tree
    | { sha: string; truncated: boolean; tree: TreeEntry[] }
  >(`${repo}/tree/${ref}`, `/repos/${repo}/git/trees/${ref}?recursive=1`);
  if ('files' in tree) return tree;
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

/**
 * `lanes` is how many requests are in flight at once. Twelve saturates an
 * HTTP/2 connection to the CDN — measured at 13.4 MB/s against 7.8 at
 * twenty-four — and that is a property of the connection, not of the caller,
 * so several readers sharing it take a share each rather than twelve apiece.
 */
export async function fetchSource(
  repo: string,
  tree: Tree,
  onProgress?: (p: Progress) => void,
  lanes = 12,
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
      // Contents are addressed by their git object id and by nothing else. An
      // entry without one cannot be cached: every such file would share a key
      // and take whichever arrived first, which is a wrong answer rather than
      // a slow one.
      const id = entry.sha;
      const key = id ? `https://cqx.invalid/blob/${id}` : null;
      let content: string | null = null;
      try {
        const hit = key ? await cache?.match(key) : null;
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
          if (key) await cache?.put(key, new Response(content));
        } catch {
          // Storage full or unavailable; the analysis does not depend on it.
        }
      }
      files.push({ path: entry.path, blob: id ?? '', content });
      done++;
      report();
    }
  };

  onProgress?.({ stage: 'contents', done: 0, total: tree.files.length, cached: 0 });
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, queue.length)) }, worker));
  return files;
}
