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
    // GitHub says why in the body, and "rate limit" and "bad credentials" want
    // different answers from whoever is reading this.
    const said = await response.text().catch(() => '');
    const why = said.slice(0, 200).replace(/\s+/g, ' ');
    throw new Error(`github ${response.status}${why ? `: ${why}` : ''}`);
  }
  return (await response.json()) as T;
}

/**
 * Which commit each tag names.
 *
 * A release names a tag, and the rail needs a commit. Asking for a repository's
 * hundred most recent tags resolves most repositories in one request — and none
 * at all in a repository that publishes several crates, where those hundred are
 * mostly other crates' tags. rust-lang/regex releases `1.0.0` while its recent
 * tags are `rure-*` and `regex-syntax-*`, so every release came back unresolved.
 *
 * So: the cheap request first, then one lookup for each tag it missed. A tag
 * points where it points, so what is learned is kept for good and a second
 * reader pays for neither.
 */
async function resolveTags(env: Env, repo: string, tags: string[]): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const wanted = new Set(tags);
  if (wanted.size === 0) return found;

  const remembered = await Promise.all(
    [...wanted].map(async (tag) => [tag, await held<string>(env, tagKey(repo, tag), Infinity)] as const),
  );
  for (const [tag, sha] of remembered) {
    if (sha) {
      found.set(tag, sha);
      wanted.delete(tag);
    }
  }
  if (wanted.size === 0) return found;

  try {
    const bulk = await ask<{ name: string; commit: { sha: string } }[]>(
      env,
      `/repos/${repo}/tags?per_page=100`,
    );
    for (const t of bulk) {
      if (wanted.has(t.name)) {
        found.set(t.name, t.commit.sha);
        wanted.delete(t.name);
        await keep(env, tagKey(repo, t.name), t.commit.sha);
      }
    }
  } catch {
    // The bulk request is an optimisation; without it every tag is looked up.
  }

  // Whatever is left, one at a time. Twenty at worst, once per repository ever.
  await Promise.all(
    [...wanted].map(async (tag) => {
      try {
        const ref = await ask<{ object: { sha: string; type: string; url: string } }>(
          env,
          `/repos/${repo}/git/ref/tags/${encodeURIComponent(tag)}`,
        );
        // An annotated tag points at a tag object, which points at the commit.
        let sha = ref.object.sha;
        if (ref.object.type === 'tag') {
          const inner = await ask<{ object: { sha: string } }>(
            env,
            `/repos/${repo}/git/tags/${sha}`,
          );
          sha = inner.object.sha;
        }
        found.set(tag, sha);
        await keep(env, tagKey(repo, tag), sha);
      } catch {
        // A tag that cannot be resolved is listed and not offered.
      }
    }),
  );
  return found;
}

const tagKey = (repo: string, tag: string) =>
  `cache/${repo}/tags/${encodeURIComponent(tag)}.json`;

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

    // What GitHub thinks of us, which is the only way to tell a token that is
    // being sent from one that is not. Never the token itself — only whether
    // there is one, and what it buys.
    if (owner === '_status') {
      try {
        const seen = await fetch('https://api.github.com/rate_limit', {
          headers: {
            accept: 'application/vnd.github+json',
            'user-agent': 'cqx-explorer',
            ...(env.GITHUB_TOKEN ? { authorization: `Bearer ${env.GITHUB_TOKEN}` } : {}),
          },
        });
        const body = (await seen.json()) as {
          resources?: { core?: { limit: number; remaining: number; reset: number } };
        };
        const core = body.resources?.core;
        return json(
          {
            tokenPresent: Boolean(env.GITHUB_TOKEN),
            githubSaid: seen.status,
            limit: core?.limit ?? null,
            remaining: core?.remaining ?? null,
            // 60 means unauthenticated whatever the worker believes it sent.
            authenticated: (core?.limit ?? 0) > 60,
          },
          0,
        );
      } catch (e) {
        return refuse(502, e instanceof Error ? e.message : String(e));
      }
    }

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

        const raw = await ask<
          { tag_name: string; published_at: string; draft: boolean; prerelease: boolean }[]
        >(env, `/repos/${repo}/releases?per_page=20`);
        const visible = raw.filter((r) => !r.draft);
        const resolved = await resolveTags(
          env,
          repo,
          visible.map((r) => r.tag_name),
        );
        const releases = visible.map((r) => ({
          tag: r.tag_name,
          sha: resolved.get(r.tag_name) ?? null,
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
