/**
 * The only server in this deployment, and it does one thing.
 *
 * Three calls to GitHub are metered — which commits a repository has, which
 * files a commit has, and which releases exist — and sixty an hour per address
 * is enough for a person to exhaust by exploring. Everything expensive is not
 * metered: file contents come from a CDN straight to the browser and never
 * pass through here.
 *
 * So this fronts the three, with a token, and keeps what it learns in the same
 * bucket the datasets live in. A tree names the files of one commit and a
 * commit does not change, so that answer is kept for good; the other two are
 * kept briefly, because a repository grows.
 *
 * What comes back is not what GitHub sent. A tree of deno is a quarter of a
 * megabyte of mode bits and blob urls, of which this needs two fields per
 * interesting file. Sending the rest to every reader would cost more than the
 * request saved.
 */

interface Env {
  ASSETS: Fetcher;
  CACHE: R2Bucket;
  /** A fine-grained token with read access to public repositories, and nothing
   *  else. Set with `wrangler secret put GITHUB_TOKEN`; never in the bundle. */
  GITHUB_TOKEN?: string;
}

/** Only these, only GET, and only for a plausible repository. */
const REPO = /^[\w.-]{1,39}\/[\w.-]{1,100}$/;
const SHA = /^[0-9a-f]{7,40}$/;

/** A commit does not change, so its tree is true for good. The other two
 *  describe a repository as it is now, which is a different kind of fact. */
const BRIEFLY = 60_000;

const json = (body: unknown, seconds: number) =>
  new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'cache-control': `public, max-age=${seconds}`,
    },
  });

const refuse = (status: number, why: string) =>
  new Response(JSON.stringify({ error: why }), {
    status,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });

interface Held<T> {
  at: number;
  value: T;
}

async function held<T>(env: Env, key: string, fresh: number): Promise<T | null> {
  try {
    const found = await env.CACHE.get(key);
    if (!found) return null;
    const stored = (await found.json()) as Held<T>;
    if (fresh !== Infinity && Date.now() - stored.at > fresh) return null;
    return stored.value;
  } catch {
    return null;
  }
}

async function keep<T>(env: Env, key: string, value: T): Promise<void> {
  try {
    await env.CACHE.put(key, JSON.stringify({ at: Date.now(), value } satisfies Held<T>), {
      httpMetadata: { contentType: 'application/json' },
    });
  } catch {
    // A full or unavailable bucket costs a request next time, not an answer now.
  }
}

async function ask<T>(env: Env, path: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'cqx-explorer',
      ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`github ${response.status}`);
  }
  return (await response.json()) as T;
}

/** Manifests, the lockfile, and the code. The same rule the analysis uses. */
const interesting = (path: string) =>
  path.endsWith('.rs') ||
  path.endsWith('/Cargo.toml') ||
  path === 'Cargo.toml' ||
  path.endsWith('/Cargo.lock') ||
  path === 'Cargo.lock';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/gh/')) {
      // Everything else is the site.
      return env.ASSETS.fetch(request);
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, OPTIONS',
          'access-control-max-age': '86400',
        },
      });
    }
    if (request.method !== 'GET') return refuse(405, 'only GET');

    const parts = url.pathname.slice('/gh/'.length).split('/').filter(Boolean);
    const [owner, name, what, arg] = parts;
    const repo = `${owner}/${name}`;
    if (!owner || !name || !REPO.test(repo)) return refuse(400, 'not a repository');

    try {
      if (what === 'commits') {
        const key = `cache/${repo}/commits.json`;
        const kept = await held<unknown[]>(env, key, BRIEFLY);
        if (kept) return json(kept, 60);
        const raw = await ask<
          { sha: string; commit: { message: string; author: { name: string; date: string } } }[]
        >(env, `/repos/${repo}/commits?per_page=20`);
        // Only what a rail shows.
        const commits = raw.map((c) => ({
          sha: c.sha,
          short: c.sha.slice(0, 8),
          subject: c.commit.message.split('\n')[0] ?? '',
          author: c.commit.author.name,
          date: c.commit.author.date,
        }));
        await keep(env, key, commits);
        return json(commits, 60);
      }

      if (what === 'releases') {
        const key = `cache/${repo}/releases.json`;
        const kept = await held<unknown[]>(env, key, BRIEFLY);
        if (kept) return json(kept, 60);
        const [raw, tags] = await Promise.all([
          ask<{ tag_name: string; published_at: string; draft: boolean; prerelease: boolean }[]>(
            env,
            `/repos/${repo}/releases?per_page=20`,
          ),
          // A release names a tag, not a commit, and target_commitish is
          // usually a branch. One request resolves every tag at once.
          ask<{ name: string; commit: { sha: string } }[]>(env, `/repos/${repo}/tags?per_page=100`),
        ]);
        const sha = new Map(tags.map((t) => [t.name, t.commit.sha]));
        const releases = raw
          .filter((r) => !r.draft)
          .map((r) => ({
            tag: r.tag_name,
            sha: sha.get(r.tag_name) ?? null,
            publishedAt: r.published_at,
            prerelease: r.prerelease,
          }));
        await keep(env, key, releases);
        return json(releases, 60);
      }

      if (what === 'tree' && arg) {
        if (!SHA.test(arg)) return refuse(400, 'not a commit');
        // Kept for good: the files of a commit are what they were.
        const key = `cache/${repo}/tree/${arg}.json`;
        const kept = await held<unknown>(env, key, Infinity);
        if (kept) return json(kept, 31536000);
        const raw = await ask<{
          sha: string;
          truncated: boolean;
          tree: { path: string; type: string; sha: string }[];
        }>(env, `/repos/${repo}/git/trees/${arg}?recursive=1`);
        const tree = {
          sha: raw.sha,
          truncated: raw.truncated,
          // Two fields per file that matters, out of the eight GitHub sends for
          // every file there is.
          files: raw.tree
            .filter((e) => e.type === 'blob' && interesting(e.path))
            .map((e) => ({ path: e.path, blob: e.sha })),
        };
        await keep(env, key, tree);
        return json(tree, 31536000);
      }

      return refuse(404, 'no such thing here');
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      // A stale answer beats none: a repository's commits from an hour ago are
      // still its commits, with one perhaps missing.
      const stale =
        what === 'commits' || what === 'releases'
          ? await held<unknown>(env, `cache/${repo}/${what}.json`, Infinity)
          : null;
      if (stale) return json(stale, 60);
      return refuse(502, `github would not answer: ${why}`);
    }
  },
};
