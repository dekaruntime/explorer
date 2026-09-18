/**
 * The analysis, off the main thread.
 *
 * Parsing a large repository takes seconds of solid CPU — seven of them for
 * deno — and on the main thread that is seven seconds of frozen tab: the
 * progress bar stops, the theme toggle does nothing, and the page looks hung
 * at exactly the moment it is working hardest.
 *
 * The fetching moved here too, rather than only the wasm call. It keeps the
 * whole pipeline in one place, and it means the file contents are never copied
 * across a postMessage boundary — a few megabytes of source that would other-
 * wise be cloned twice.
 *
 * A finished dataset is kept, for the same reason its files are: it is named by
 * a commit and a commit does not change, so it can never be stale. Without that
 * every step along the time machine paid the full analysis again — 0.7s for a
 * small repository, seven for a large one — to produce bytes it had already
 * produced a moment earlier.
 */

import { Analysis } from './cqx';
import { fetchSource, fetchTree } from './github';

export interface Request {
  repo: string;
  /** The full sha, which is what the CDN addresses a file by. */
  sha: string;
  /** Where to load the module from; the worker has no notion of the page. */
  wasm: string;
}

export type Reply =
  | { type: 'stage'; phase: 'listing' | 'fetching' | 'analysing'; done: number; total: number; cached: number }
  | { type: 'done'; json: string; ms: number; fetch: number }
  | { type: 'error'; message: string };

const post = (reply: Reply) => self.postMessage(reply);

/** Bumped when the shape changes, so an old dataset is not read as a new one. */
/**
 * v2 because v1 may hold datasets built while every file in a repository
 * carried the first file's contents — a tree whose entries named their blob
 * `blob` rather than `sha` gave them all one cache key. Those datasets are
 * wrong and cannot be told apart from right ones, so the whole store is left
 * behind rather than trusted.
 */
const DATASETS = 'cqx-datasets-v2';

/** A commit, and the version of cqx that read it. */
const key = (repo: string, sha: string) => `https://cqx.invalid/dataset/${repo}/${sha}`;

async function remembered(repo: string, sha: string): Promise<Reply | null> {
  try {
    const hit = await (await caches.open(DATASETS)).match(key(repo, sha));
    if (!hit) return null;
    const { json, ms, fetch } = (await hit.json()) as { json: string; ms: number; fetch: number };
    return { type: 'done', json, ms, fetch: fetch ?? 0 };
  } catch {
    // Private windows, blocked storage, a cache that misbehaves: analyse it.
    return null;
  }
}

async function remember(repo: string, sha: string, json: string, ms: number, fetch: number) {
  try {
    await (await caches.open(DATASETS)).put(
      key(repo, sha),
      new Response(JSON.stringify({ json, ms, fetch }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
  } catch {
    // Storage full or unavailable. Nothing here depends on it.
  }
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const { repo, sha, wasm } = event.data;
  try {
    // Already analysed in this browser: no tree request, no files, no parsing.
    const known = await remembered(repo, sha);
    if (known) {
      post(known);
      return;
    }

    const began = performance.now();
    post({ type: 'stage', phase: 'listing', done: 0, total: 0, cached: 0 });
    // The module says how many files it will read, because only it knows: a
    // repository holds more .rs files than its crates claim, and counting what
    // was fetched made a finished analysis look stalled at forty-five per cent.
    // Reported no more often than a screen can show — six thousand messages to
    // draw sixty frames is waste.
    let parsed = 0;
    let announced = 0;
    let expected = 0;
    const watch = {
      total: (files: number) => {
        expected = files;
        post({ type: 'stage', phase: 'analysing', done: 0, total: files, cached: 0 });
      },
      one: () => {
        parsed += 1;
        if (parsed - announced >= 25 || parsed === expected) {
          announced = parsed;
          post({ type: 'stage', phase: 'analysing', done: parsed, total: expected, cached: 0 });
        }
      },
    };

    // A new instance each time, and the last one goes. Linear memory never
    // shrinks, so an instance that has read a large repository would hand the
    // next one a heap already spent. The compiled module is kept and reused;
    // it is the expensive half and it holds nothing.
    const [cqx, tree] = await Promise.all([Analysis.load(wasm, watch), fetchTree(repo, sha)]);

    if (tree.truncated) {
      throw new Error(`${repo} is too large for GitHub to list in one request.`);
    }
    if (tree.files.length === 0) {
      throw new Error(`${repo} has no Rust to analyse at ${sha.slice(0, 8)}.`);
    }

    const files = await fetchSource(repo, tree, (p) =>
      post({ type: 'stage', phase: 'fetching', done: p.done, total: p.total, cached: p.cached }),
    );
    // Everything up to here is network and cache. What follows is this machine.
    const fetched = Math.round(performance.now() - began);

    // The count comes from the module, once it has read the manifests.
    post({ type: 'stage', phase: 'analysing', done: 0, total: 0, cached: 0 });
    cqx.reset(repo);
    for (const file of files) cqx.addFile(file.path, file.content);

    const { json, ms } = cqx.dataset(repo);
    // Kept before it is sent, so a second click cannot race the first.
    await remember(repo, sha, json, ms, fetched);
    post({ type: 'done', json, ms, fetch: fetched });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
