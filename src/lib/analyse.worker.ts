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
  | { type: 'stage'; note: string; done: number; total: number }
  | { type: 'done'; json: string; ms: number }
  | { type: 'error'; message: string };

let module: Promise<Analysis> | null = null;

const post = (reply: Reply) => self.postMessage(reply);

self.onmessage = async (event: MessageEvent<Request>) => {
  const { repo, sha, wasm } = event.data;
  try {
    post({ type: 'stage', note: 'reading the file list', done: 0, total: 0 });
    module ??= Analysis.load(wasm);
    const [cqx, tree] = await Promise.all([module, fetchTree(repo, sha)]);

    if (tree.truncated) {
      throw new Error(`${repo} is too large for GitHub to list in one request.`);
    }
    if (tree.files.length === 0) {
      throw new Error(`${repo} has no Rust to analyse at ${sha.slice(0, 8)}.`);
    }

    const files = await fetchSource(repo, tree, (p) =>
      post({
        type: 'stage',
        note: p.cached ? `reading files · ${p.cached} already cached` : 'reading files',
        done: p.done,
        total: p.total,
      }),
    );

    post({ type: 'stage', note: 'analysing', done: files.length, total: files.length });
    cqx.reset(repo);
    for (const file of files) cqx.addFile(file.path, file.content);

    const { json, ms } = cqx.dataset(repo);
    post({ type: 'done', json, ms });
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) });
  }
};
